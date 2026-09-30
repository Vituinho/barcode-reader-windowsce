using System;
using System.Collections.Generic;
using System.IO;
using GivovaCollector.Core;
using GivovaCollector.Net;

namespace GivovaCollector.Tools
{
    /// <summary>
    /// End-to-end acceptance scenarios A-F (+ closed session) against a running API, using the
    /// collector's real JournalScanStore, ScanProcessor, SyncService and HttpWebRequest ApiClient.
    ///
    /// Environment: GIVOVA_API (default http://127.0.0.1:8000), GIVOVA_DEVICE (GVT-CE-001),
    /// GIVOVA_OPERATOR / GIVOVA_OPERATOR_PASSWORD, GIVOVA_ADMIN / GIVOVA_ADMIN_PASSWORD.
    /// </summary>
    public static class ScenarioRunner
    {
        private const string DeadUrl = "http://127.0.0.1:9"; // nothing listens here: simulates Wi-Fi down

        private static string _api;
        private static string _device;
        private static string _adminToken;
        private static string _run;
        private static int _failed;

        private class Collector
        {
            public string Dir;
            public AppConfig Config;
            public AppState State;
            public JournalScanStore Store;
            public ScanProcessor Processor;
            public SyncService Sync;

            /// <summary>Simulates an application (re)start: everything reloaded from disk.</summary>
            public static Collector Boot(string dir, IScanApi api)
            {
                Collector c = new Collector();
                c.Dir = dir;
                c.Config = AppConfig.Load(Path.Combine(dir, "collector.ini"));
                c.State = new AppState(Path.Combine(dir, "state.ini"));
                c.State.Load();
                c.Store = new JournalScanStore(dir);
                c.Store.Open();
                c.Processor = new ScanProcessor(c.Store, c.Config, c.State);
                c.Sync = new SyncService(c.Store, api, c.Config, c.State, "scenario");
                return c;
            }

            public void Drain()
            {
                for (int i = 0; i < 20 && Store.PendingCount > 0; i++)
                {
                    Sync.RunOnce();
                    if (Sync.Connection != ConnectionState.Online) break;
                }
            }
        }

        /// <summary>Stores on the server, then "loses" the response like a dropped Wi-Fi link.</summary>
        private class LostResponseApi : IScanApi
        {
            private readonly IScanApi _inner;
            public LostResponseApi(IScanApi inner) { _inner = inner; }
            public void Ping() { _inner.Ping(); }
            public LoginResult Login(string u, string p, string d) { return _inner.Login(u, p, d); }
            public List<SessionInfo> GetOpenSessions(string t) { return _inner.GetOpenSessions(t); }
            public void SendHeartbeat(HeartbeatInfo i, string t) { _inner.SendHeartbeat(i, t); }
            public DeviceConfigInfo GetDeviceConfig(string d, string t) { return _inner.GetDeviceConfig(d, t); }

            public ScanApiResult SendScan(ScanRecord record, string token)
            {
                _inner.SendScan(record, token);
                throw new ApiException(ApiErrorKind.Network, 0, "READ", "connection reset before response");
            }
        }

        public static int Main(string[] args)
        {
            _api = Env("GIVOVA_API", "http://127.0.0.1:8000");
            _device = Env("GIVOVA_DEVICE", "GVT-CE-001");
            _run = DateTime.Now.ToString("HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 4);
            string baseDir = Path.Combine(Path.GetTempPath(), "givova-scenarios-" + _run);
            Directory.CreateDirectory(baseDir);
            Logger.Init(Path.Combine(baseDir, "logs"), 1024 * 1024);
            Console.WriteLine("API " + _api + "  device " + _device + "  run " + _run);

            ApiClient real = new ApiClient(_api, 10, "ScenarioRunner");
            ApiClient dead = new ApiClient(DeadUrl, 3, "ScenarioRunner");

            LoginResult admin = real.Login(Env("GIVOVA_ADMIN", "admin@example.com"), Env("GIVOVA_ADMIN_PASSWORD", ""), null);
            _adminToken = admin.Token;
            string sessionId = CreateSession("CENARIOS " + _run);

            Run("A online: scan -> local save -> API -> synced -> REGISTRADO", delegate
            {
                Collector c = NewCollector(baseDir, "A", real, sessionId);
                int before = ServerCount("7891234567890");
                ScanOutcome o = c.Processor.Process("7891234567890\r");
                Check(o.Kind == ScanOutcomeKind.Saved, "saved locally first");
                Check(c.Store.Get(o.Record.ClientScanId).IsPending, "pending before sync");
                c.Sync.RunOnce();
                ScanRecord r = c.Store.Get(o.Record.ClientScanId);
                Check(r.Status == ScanStatus.Synced && r.ServerResult == "KNOWN", "synced as KNOWN: " + r.Status + "/" + r.ServerResult);
                Check(r.ItemName == "Colchão Ortobom Orion", "item name: " + r.ItemName);
                Check(ServerCount("7891234567890") == before + 1, "exactly one new server record");
            });

            Run("B unknown barcode accepted, registered UNKNOWN, collector continues", delegate
            {
                Collector c = NewCollector(baseDir, "B", real, sessionId);
                string code = "0099" + _run.Replace("-", "");
                ScanOutcome o = c.Processor.Process(code + "\r");
                ScanOutcome next = c.Processor.Process("7891234567890\r");
                c.Sync.RunOnce();
                ScanRecord r = c.Store.Get(o.Record.ClientScanId);
                Check(r.Status == ScanStatus.Synced && r.ServerResult == "UNKNOWN", "UNKNOWN accepted");
                Check(c.Store.Get(next.Record.ClientScanId).Status == ScanStatus.Synced, "next scan also synced");
                Check(CountJson("/api/admin/barcodes?status=UNKNOWN&q=" + code) == 1, "barcode registry has UNKNOWN entry");
                Check(ServerCount(code) == 1, "scan stored");
            });

            Run("C Wi-Fi down: 10 scans saved, restart, still pending, Wi-Fi back, all synced", delegate
            {
                string dir = Path.Combine(baseDir, "C");
                Collector c = NewCollector(baseDir, "C", dead, sessionId);
                string prefix = "SCN-C-" + _run + "-";
                for (int i = 0; i < 10; i++)
                    Check(c.Processor.Process(prefix + i + "\r").Kind == ScanOutcomeKind.Saved, "saved " + i);
                c.Sync.RunOnce();
                Check(c.Sync.Connection == ConnectionState.Offline, "offline detected");
                Check(c.Store.PendingCount == 10, "10 pending while offline");

                Collector restarted = Collector.Boot(dir, dead);
                Check(restarted.Store.PendingCount == 10, "10 pending after app restart");

                restarted.Sync.Api = real; // Wi-Fi restored
                restarted.Drain();
                Check(restarted.Store.PendingCount == 0, "0 pending after sync");
                Check(ServerCount(prefix) == 10, "server has exactly 10: " + ServerCount(prefix));
            });

            Run("D response lost after server stored: resend is idempotent", delegate
            {
                Collector c = NewCollector(baseDir, "D", new LostResponseApi(real), sessionId);
                string code = "SCN-D-" + _run;
                ScanOutcome o = c.Processor.Process(code + "\r");
                c.Sync.RunOnce();
                ScanRecord r = c.Store.Get(o.Record.ClientScanId);
                Check(r.IsPending && r.SyncAttempts == 1, "still pending after lost response");
                Check(ServerCount(code) == 1, "server already stored it");
                c.Sync.Api = real;
                c.Sync.RunOnce();
                Check(c.Store.Get(o.Record.ClientScanId).Status == ScanStatus.Synced, "synced on retry");
                Check(ServerCount(code) == 1, "still exactly one server record (no duplicate)");
            });

            Run("E rapid double trigger: one business scan, second shown as duplicate", delegate
            {
                Collector c = NewCollector(baseDir, "E", real, sessionId);
                string code = "SCN-E-" + _run;
                ScanOutcome first = c.Processor.Process(code + "\r");
                ScanOutcome second = c.Processor.Process(code + "\r");
                Check(first.Kind == ScanOutcomeKind.Saved, "first saved");
                Check(second.Kind == ScanOutcomeKind.Duplicate, "second flagged DUPLICADO locally");
                c.Sync.RunOnce();
                Check(ServerCount(code) == 1, "one server record");

                // Server-side guard (e.g. two queue entries 1s apart): stored as DUPLICATE, not a business scan.
                string code2 = "SCN-E2-" + _run;
                ScanRecord a = CopyWithId(c, code2, DateTime.Now);
                ScanRecord b = CopyWithId(c, code2, DateTime.Now.AddSeconds(1));
                c.Store.Append(a);
                c.Store.Append(b);
                c.Sync.RunOnce();
                Check(c.Store.Get(b.ClientScanId).ServerResult == "DUPLICATE", "server answered DUPLICATE");
                Check(CountJson("/api/admin/scans?syncState=ACCEPTED&barcode=" + code2) == 1, "one ACCEPTED business scan");
            });

            Run("F device restart with pending scans: reload and background sync resumes", delegate
            {
                string dir = Path.Combine(baseDir, "F");
                Collector c = NewCollector(baseDir, "F", dead, sessionId);
                string prefix = "SCN-F-" + _run + "-";
                for (int i = 0; i < 3; i++) c.Processor.Process(prefix + i + "\r");
                c.Sync.RunOnce();
                Check(c.Store.PendingCount == 3, "3 pending before shutdown");

                Collector restarted = Collector.Boot(dir, real);
                Check(restarted.State.UsableToken != null && restarted.State.HasSession, "login+session restored");
                restarted.Sync.Start(); // same thread the app starts on boot
                for (int i = 0; i < 100 && restarted.Store.PendingCount > 0; i++) System.Threading.Thread.Sleep(100);
                restarted.Sync.Stop();
                Check(restarted.Store.PendingCount == 0, "background sync drained queue");
                Check(ServerCount(prefix) == 3, "server has 3");
            });

            Run("G session closed while offline: scans kept as conflict, not discarded", delegate
            {
                string closing = CreateSession("FECHADA " + _run);
                Collector c = NewCollector(baseDir, "G", dead, closing);
                string code = "SCN-G-" + _run;
                ScanOutcome o = c.Processor.Process(code + "\r");
                c.Sync.RunOnce();
                new ApiClient(_api, 10, "ScenarioRunner").Request("POST", "/api/admin/sessions/" + closing + "/close", "{}", _adminToken);
                c.Sync.Api = real;
                c.Sync.RunOnce();
                ScanRecord r = c.Store.Get(o.Record.ClientScanId);
                Check(r.Status == ScanStatus.Conflict && r.ServerResult == "SESSION_CLOSED", "local CONFLICT/SESSION_CLOSED");
                Check(CountJson("/api/admin/scans?syncState=CONFLICT&barcode=" + code) == 1, "server keeps it for review");
            });

            Console.WriteLine();
            Console.WriteLine(_failed == 0 ? "ALL SCENARIOS PASSED" : _failed + " SCENARIO(S) FAILED");
            return _failed == 0 ? 0 : 1;
        }

        private delegate void Scenario();

        private static void Run(string name, Scenario scenario)
        {
            try
            {
                scenario();
                Console.WriteLine("PASS " + name);
            }
            catch (Exception ex)
            {
                _failed++;
                Console.WriteLine("FAIL " + name + ": " + ex.Message);
            }
        }

        private static void Check(bool condition, string what)
        {
            if (!condition) throw new Exception(what);
        }

        private static string Env(string name, string fallback)
        {
            string v = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrEmpty(v) ? fallback : v;
        }

        private static Collector NewCollector(string baseDir, string name, IScanApi api, string sessionId)
        {
            string dir = Path.Combine(baseDir, name);
            Directory.CreateDirectory(dir);
            AppConfig config = AppConfig.Load(Path.Combine(dir, "collector.ini"));
            config.DeviceId = _device;
            config.ApiBaseUrl = _api;
            config.Save();

            ApiClient real = new ApiClient(_api, 10, "ScenarioRunner");
            LoginResult login = real.Login(Env("GIVOVA_OPERATOR", "operator@example.com"),
                                           Env("GIVOVA_OPERATOR_PASSWORD", ""), _device);
            AppState state = new AppState(Path.Combine(dir, "state.ini"));
            state.SetLogin("operator", login.UserId, login.FullName, login.Token, login.ExpiresUtc);
            state.SetSession(sessionId, "CENARIOS");
            return Collector.Boot(dir, api);
        }

        private static ScanRecord CopyWithId(Collector c, string code, DateTime at)
        {
            ScanRecord r = new ScanRecord();
            r.ClientScanId = ScanIdGenerator.NewId(_device, at);
            r.DeviceId = _device;
            r.OperatorId = c.State.OperatorId;
            r.SessionId = c.State.SessionId;
            r.Barcode = code;
            r.RawBarcode = code + "\r";
            r.ScannedAtDevice = Util.FormatLocal(at);
            r.CreatedAtLocal = r.ScannedAtDevice;
            return r;
        }

        private static string CreateSession(string name)
        {
            string body = new JsonObjectBuilder().Add("name", name).Add("sessionType", "RECEIVING").ToString();
            string json = new ApiClient(_api, 10, "ScenarioRunner").Request("POST", "/api/admin/sessions", body, _adminToken);
            return Json.GetString(Json.ParseObject(json), "id");
        }

        private static int ServerCount(string barcode)
        {
            return CountJson("/api/admin/scans?limit=1&deviceId=" + _device + "&barcode=" + barcode);
        }

        /// <summary>Returns "total" of a page response, or the length of a list response.</summary>
        private static int CountJson(string path)
        {
            string json = new ApiClient(_api, 10, "ScenarioRunner").Request("GET", path, null, _adminToken);
            object parsed = Json.Parse(json);
            List<object> list = parsed as List<object>;
            if (list != null) return list.Count;
            return Json.GetInt((Dictionary<string, object>)parsed, "total", -1);
        }
    }
}
