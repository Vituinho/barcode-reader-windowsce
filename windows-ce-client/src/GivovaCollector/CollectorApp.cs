using System;
using System.Collections.Generic;
using System.IO;
using GivovaCollector.Core;
using GivovaCollector.Net;
using GivovaCollector.Platform;

namespace GivovaCollector
{
    public static class AppInfo
    {
        public const string Version = "1.0.0";
        public const string Name = "GIVOVA - COLETA";
    }

    /// <summary>Composition root: configuration, local queue, scan processor and sync service.</summary>
    public class CollectorApp
    {
        public readonly string AppDirectory;
        public readonly string DataDirectory;
        public readonly AppConfig Config;
        public readonly AppState State;
        public readonly JournalScanStore Store;
        public readonly ScanProcessor Processor;
        public readonly SyncService Sync;

        private CollectorApp(string appDirectory)
        {
            AppDirectory = appDirectory;
            string configPath = Path.Combine(appDirectory, "collector.ini");
            bool firstRun = !File.Exists(configPath);
            Config = AppConfig.Load(configPath);
            DataDirectory = Config.ResolveDataDirectory(appDirectory);
            if (!Directory.Exists(DataDirectory)) Directory.CreateDirectory(DataDirectory);
            Logger.Init(Path.Combine(DataDirectory, "logs"), 256 * 1024);
            Logger.Info("app started v" + AppInfo.Version + " device=" + Config.DeviceId + " os=" + Environment.OSVersion);
            if (firstRun)
            {
                try { Config.Save(); }
                catch (Exception ex) { Logger.Error("could not write default config", ex); }
            }

            State = new AppState(Path.Combine(DataDirectory, "state.ini"));
            State.Load();

            // Pending scans from before a crash/restart are loaded here and resent by the sync thread.
            Store = new JournalScanStore(DataDirectory);
            Store.Open();
            try
            {
                if (Store.NeedsCompaction(DateTime.Today)) Store.Compact(DateTime.Today);
            }
            catch (Exception ex)
            {
                Logger.Error("startup compaction failed (journal kept)", ex);
            }

            Processor = new ScanProcessor(Store, Config, State);
            Sync = new SyncService(Store, CreateApi(), Config, State, AppInfo.Version);
        }

        public static CollectorApp Start(string appDirectory)
        {
            return new CollectorApp(appDirectory);
        }

        public IScanApi CreateApi()
        {
            return CreateApi(Config.ApiBaseUrl, Config.RequestTimeoutSeconds);
        }

        public IScanApi CreateApi(string baseUrl, int timeoutSeconds)
        {
            return new ApiClient(baseUrl, timeoutSeconds, "GivovaCollector/" + AppInfo.Version + " (" + Config.DeviceId + ")");
        }

        /// <summary>Call after settings were saved.</summary>
        public void ApplyConfigChange()
        {
            Sync.Api = CreateApi();
            Sync.Trigger(true);
        }

        /// <summary>Server-provided per-device values override local defaults for this run.</summary>
        public void ApplyServerConfig(DeviceConfigInfo info)
        {
            if (info == null) return;
            if (info.SyncIntervalSeconds > 0) Config.SyncIntervalSeconds = info.SyncIntervalSeconds;
            if (info.DuplicateWindowSeconds >= 0) Config.DuplicateWindowSeconds = info.DuplicateWindowSeconds;
        }

        public void Logout()
        {
            Logger.Info("logout operator=" + State.OperatorId + " pending=" + Store.PendingCount);
            State.Logout();
        }

        // ---- session list cache (lets the operator pick a session while offline) ----------------

        private string SessionCachePath { get { return Path.Combine(DataDirectory, "sessions.cache"); } }

        public void SaveSessionCache(List<SessionInfo> sessions)
        {
            IniFile ini = new IniFile();
            for (int i = 0; i < sessions.Count; i++)
                ini.Set("s" + i, sessions[i].Id + "|" + sessions[i].Name.Replace("|", "/"));
            try { ini.Save(SessionCachePath, "open sessions cache"); }
            catch (Exception ex) { Logger.Error("session cache save failed", ex); }
        }

        public List<SessionInfo> LoadSessionCache()
        {
            List<SessionInfo> list = new List<SessionInfo>();
            try
            {
                IniFile ini = IniFile.Load(SessionCachePath);
                for (int i = 0; i < 500; i++)
                {
                    string v = ini.Get("s" + i, null);
                    if (v == null) break;
                    int bar = v.IndexOf('|');
                    if (bar <= 0) continue;
                    SessionInfo s = new SessionInfo();
                    s.Id = v.Substring(0, bar);
                    s.Name = v.Substring(bar + 1);
                    list.Add(s);
                }
            }
            catch (Exception ex)
            {
                Logger.Error("session cache load failed", ex);
            }
            return list;
        }

        public void Shutdown()
        {
            try { Sync.Stop(); }
            catch (Exception ex) { Logger.Error("sync stop", ex); }
            Logger.Info("app closed pending=" + Store.PendingCount);
        }

        public static string DescribeConnection(ConnectionState state)
        {
            switch (state)
            {
                case ConnectionState.Online: return "ONLINE";
                case ConnectionState.Offline: return "OFFLINE";
                case ConnectionState.ServerError: return "ERRO SERVIDOR";
                case ConnectionState.LoginRequired: return "LOGIN EXPIRADO";
                case ConnectionState.DeviceBlocked: return "COLETOR BLOQUEADO";
                default: return "...";
            }
        }
    }
}
