using System;
using System.Collections.Generic;
using System.Threading;
using GivovaCollector.Core;
using GivovaCollector.Platform;

namespace GivovaCollector.Net
{
    public enum ConnectionState
    {
        Unknown,
        Online,
        Offline,
        ServerError,
        LoginRequired,
        DeviceBlocked
    }

    public class ScanSyncedEventArgs : EventArgs
    {
        public readonly ScanRecord Record;
        /// <summary>Server answer for this sync (null when the server rejected the record).</summary>
        public readonly ScanApiResult Result;

        public ScanSyncedEventArgs(ScanRecord record, ScanApiResult result)
        {
            Record = record;
            Result = result;
        }
    }

    /// <summary>
    /// Background synchronization of the local queue. One dedicated thread, sends pending scans
    /// in scan order, one at a time. A record leaves PENDING only after the server answered.
    /// Transient failures stop the pass and back off (no aggressive loop). Events are raised
    /// on the sync thread; UI code must marshal to the UI thread.
    /// </summary>
    public class SyncService
    {
        public const int BatchSize = 50;
        private const int MaxBackoffSeconds = 60;
        private const int CompactionCheckMs = 10 * 60 * 1000;

        private readonly ILocalScanStore _store;
        private readonly AppConfig _config;
        private readonly AppState _state;
        private readonly string _appVersion;
        private readonly AutoResetEvent _wake = new AutoResetEvent(false);
        private readonly object _sync = new object();

        private IScanApi _api;
        private Thread _thread;
        private volatile bool _running;
        private ConnectionState _connection = ConnectionState.Unknown;
        private string _lastError = "";
        private int _failures;
        private bool _moreQueued;
        private int _lastHeartbeatTicks;
        private bool _heartbeatSent;
        private int _lastCompactionCheckTicks;

        public event EventHandler StatusChanged;
        public event EventHandler<ScanSyncedEventArgs> ScanSynced;

        public SyncService(ILocalScanStore store, IScanApi api, AppConfig config, AppState state, string appVersion)
        {
            _store = store;
            _api = api;
            _config = config;
            _state = state;
            _appVersion = appVersion;
            _lastCompactionCheckTicks = Environment.TickCount;
        }

        /// <summary>Replaced when the API URL/timeout changes in settings.</summary>
        public IScanApi Api
        {
            get { lock (_sync) return _api; }
            set { lock (_sync) _api = value; }
        }

        public ConnectionState Connection { get { lock (_sync) return _connection; } }
        public string LastError { get { lock (_sync) return _lastError; } }
        public int ConsecutiveFailures { get { lock (_sync) return _failures; } }

        public void Start()
        {
            if (_running) return;
            _running = true;
            _thread = new Thread(new ThreadStart(Loop));
            _thread.IsBackground = true;
            _thread.Start();
            Logger.Info("sync service started");
        }

        public void Stop()
        {
            _running = false;
            _wake.Set();
            if (_thread != null) _thread.Join(3000);
        }

        /// <summary>
        /// manual=true (operator pressed SINCRONIZAR, new login, settings saved): resets backoff.
        /// manual=false (new scan): wakes the thread only when the server is believed reachable.
        /// </summary>
        public void Trigger(bool manual)
        {
            lock (_sync)
            {
                if (manual)
                {
                    _failures = 0;
                    _heartbeatSent = false;
                }
                else if (_connection != ConnectionState.Online && _connection != ConnectionState.Unknown)
                {
                    return;
                }
            }
            _wake.Set();
        }

        private void Loop()
        {
            while (_running)
            {
                try
                {
                    _moreQueued = RunOnce();
                    if (_running) MaybeHeartbeat();
                    if (_running) MaybeCompact();
                }
                catch (Exception ex)
                {
                    // A failed pass must never kill the thread or the app.
                    Logger.Error("sync loop error", ex);
                    lock (_sync) _failures++;
                }
                _wake.WaitOne(NextDelayMs(), false);
            }
        }

        private int NextDelayMs()
        {
            lock (_sync)
            {
                switch (_connection)
                {
                    case ConnectionState.Online:
                        return _moreQueued ? 100 : _config.SyncIntervalSeconds * 1000;
                    case ConnectionState.LoginRequired:
                        return 30000;
                    case ConnectionState.DeviceBlocked:
                        return MaxBackoffSeconds * 1000;
                    default:
                        int seconds = _config.SyncIntervalSeconds;
                        for (int i = 1; i < _failures && seconds < MaxBackoffSeconds; i++) seconds *= 2;
                        return Math.Min(seconds, MaxBackoffSeconds) * 1000;
                }
            }
        }

        /// <summary>One synchronization pass. Returns true if more pending records remain queued.</summary>
        public bool RunOnce()
        {
            string token = _state.UsableToken;
            if (token == null)
            {
                SetConnection(ConnectionState.LoginRequired, "LOGIN NECESSARIO");
                return false;
            }
            IScanApi api = Api;
            List<ScanRecord> batch = _store.GetPending(BatchSize);
            if (batch.Count == 0)
            {
                if (Connection != ConnectionState.Online)
                {
                    try
                    {
                        api.Ping();
                        MarkSuccess();
                    }
                    catch (ApiException ex)
                    {
                        HandleFailure(ex, null);
                    }
                }
                return false;
            }

            foreach (ScanRecord record in batch)
            {
                ScanApiResult result;
                try
                {
                    result = api.SendScan(record, token);
                }
                catch (ApiException ex)
                {
                    if (HandleFailure(ex, record)) continue;
                    return false;
                }
                Apply(record, result);
                MarkSuccess();
            }
            return batch.Count == BatchSize;
        }

        private void Apply(ScanRecord record, ScanApiResult result)
        {
            try
            {
                if (!result.Accepted)
                    _store.MarkRejected(record.ClientScanId, result.Error ?? result.Message ?? "REJEITADO");
                else if (result.Result == "SESSION_CLOSED" || result.Result == "SESSION_NOT_FOUND")
                    _store.MarkConflict(record.ClientScanId, result.ServerScanId, result.Result, result.Message ?? result.Result);
                else
                    _store.MarkSynced(record.ClientScanId, result.ServerScanId, result.Result, result.ItemName);
            }
            catch (Exception ex)
            {
                // Could not persist the confirmation: record stays PENDING and will be resent.
                // The server answers a resend with the stored result (idempotent), so nothing duplicates.
                Logger.Error("could not persist sync confirmation " + record.ClientScanId, ex);
                return;
            }
            Logger.Info("sync ok id=" + record.ClientScanId + " result=" + result.Result + (result.Replayed ? " (replayed)" : ""));
            RaiseScanSynced(_store.Get(record.ClientScanId), result);
        }

        /// <summary>Returns true when the pass may continue with the next record.</summary>
        private bool HandleFailure(ApiException ex, ScanRecord record)
        {
            switch (ex.Kind)
            {
                case ApiErrorKind.Unauthorized:
                    _state.MarkTokenRejected();
                    SetConnection(ConnectionState.LoginRequired, "LOGIN EXPIRADO");
                    Logger.Warn("sync: token rejected by server");
                    return false;

                case ApiErrorKind.Forbidden:
                    lock (_sync) _failures++;
                    SetConnection(ConnectionState.DeviceBlocked, ex.ErrorCode ?? "BLOQUEADO");
                    Logger.Warn("sync: forbidden " + ex.ErrorCode);
                    return false;

                case ApiErrorKind.Rejected:
                    if (record == null) return false;
                    try
                    {
                        _store.MarkRejected(record.ClientScanId, (ex.ErrorCode ?? "HTTP " + ex.StatusCode) + ": " + ex.Message);
                    }
                    catch (Exception storeEx)
                    {
                        Logger.Error("could not mark rejected", storeEx);
                        return false;
                    }
                    Logger.Warn("sync rejected id=" + record.ClientScanId + " " + ex.ErrorCode);
                    RaiseScanSynced(_store.Get(record.ClientScanId), null);
                    return true;

                default:
                    if (record != null)
                    {
                        try { _store.MarkAttemptFailed(record.ClientScanId, ex.Message); }
                        catch (Exception storeEx) { Logger.Error("could not record attempt", storeEx); }
                    }
                    lock (_sync) _failures++;
                    SetConnection(ex.Kind == ApiErrorKind.Network ? ConnectionState.Offline : ConnectionState.ServerError,
                                  ex.Message);
                    Logger.Warn("sync failed: " + ex.Kind + " " + ex.Message);
                    return false;
            }
        }

        private void MaybeHeartbeat()
        {
            string token = _state.UsableToken;
            if (token == null) return;
            lock (_sync)
            {
                int elapsed = Util.TicksElapsed(_lastHeartbeatTicks, Environment.TickCount);
                if (_heartbeatSent && elapsed < _config.HeartbeatIntervalSeconds * 1000) return;
                if (_connection != ConnectionState.Online && _connection != ConnectionState.Unknown) return;
                _lastHeartbeatTicks = Environment.TickCount;
                _heartbeatSent = true;
            }
            HeartbeatInfo hb = new HeartbeatInfo();
            hb.DeviceId = _config.DeviceId;
            hb.AppVersion = _appVersion;
            hb.OperatorId = _state.OperatorId;
            hb.BatteryLevel = DeviceServices.GetBatteryPercent();
            hb.PendingScans = _store.PendingCount;
            hb.Timestamp = DateTime.Now;
            try
            {
                Api.SendHeartbeat(hb, token);
                MarkSuccess();
            }
            catch (ApiException ex)
            {
                HandleFailure(ex, null);
            }
        }

        private void MaybeCompact()
        {
            if (Util.TicksElapsed(_lastCompactionCheckTicks, Environment.TickCount) < CompactionCheckMs) return;
            _lastCompactionCheckTicks = Environment.TickCount;
            try
            {
                if (_store.NeedsCompaction(DateTime.Today)) _store.Compact(DateTime.Today);
            }
            catch (Exception ex)
            {
                Logger.Error("compaction failed (journal kept as is)", ex);
            }
        }

        private void MarkSuccess()
        {
            lock (_sync) _failures = 0;
            SetConnection(ConnectionState.Online, "");
        }

        private void SetConnection(ConnectionState state, string error)
        {
            bool changed;
            lock (_sync)
            {
                changed = _connection != state || _lastError != error;
                _connection = state;
                _lastError = error ?? "";
            }
            if (!changed) return;
            EventHandler handler = StatusChanged;
            if (handler != null)
            {
                try { handler(this, EventArgs.Empty); }
                catch (Exception ex) { Logger.Error("StatusChanged handler", ex); }
            }
        }

        private void RaiseScanSynced(ScanRecord record, ScanApiResult result)
        {
            EventHandler<ScanSyncedEventArgs> handler = ScanSynced;
            if (handler == null || record == null) return;
            try { handler(this, new ScanSyncedEventArgs(record, result)); }
            catch (Exception ex) { Logger.Error("ScanSynced handler", ex); }
        }
    }
}
