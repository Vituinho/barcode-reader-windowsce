using System;

namespace GivovaCollector.Core
{
    public enum ScanOutcomeKind
    {
        Ignored,
        Saved,
        Duplicate,
        Error
    }

    public class ScanOutcome
    {
        public ScanOutcomeKind Kind;
        public ScanRecord Record;
        public string Barcode;
        public string Message;

        public static ScanOutcome Of(ScanOutcomeKind kind, string barcode, string message)
        {
            ScanOutcome o = new ScanOutcome();
            o.Kind = kind;
            o.Barcode = barcode;
            o.Message = message;
            return o;
        }
    }

    /// <summary>
    /// Turns raw scanner input into a durable queue record. Invariant:
    /// the record is on persistent storage BEFORE the outcome reports Saved.
    /// No network access happens here.
    /// </summary>
    public class ScanProcessor
    {
        public const int MaxBarcodeLength = 512;

        private readonly ILocalScanStore _store;
        private readonly AppConfig _config;
        private readonly AppState _state;
        private readonly DuplicateDetector _duplicates;

        public ScanProcessor(ILocalScanStore store, AppConfig config, AppState state)
        {
            _store = store;
            _config = config;
            _state = state;
            _duplicates = new DuplicateDetector(config.DuplicateWindowSeconds);
        }

        public DuplicateDetector Duplicates { get { return _duplicates; } }

        public ScanOutcome Process(string raw)
        {
            return Process(raw, DateTime.Now, Environment.TickCount);
        }

        public ScanOutcome Process(string raw, DateTime now, int nowTicks)
        {
            string barcode = BarcodeCleaner.Clean(raw);
            if (barcode.Length == 0) return ScanOutcome.Of(ScanOutcomeKind.Ignored, barcode, null);
            if (barcode.Length > MaxBarcodeLength)
                return ScanOutcome.Of(ScanOutcomeKind.Error, Util.Shorten(barcode, 40), "CÓDIGO MUITO LONGO");
            if (!_state.HasOperator) return ScanOutcome.Of(ScanOutcomeKind.Error, barcode, "SEM LOGIN");
            if (!_state.HasSession) return ScanOutcome.Of(ScanOutcomeKind.Error, barcode, "SEM SESSÃO");

            string operatorId = _state.OperatorId;
            string sessionId = _state.SessionId;
            string key = DuplicateDetector.Key(_config.DeviceId, operatorId, sessionId, barcode);
            _duplicates.WindowSeconds = _config.DuplicateWindowSeconds;
            if (_duplicates.IsDuplicate(key, nowTicks))
            {
                Logger.Info("scan duplicate ignored (window " + _config.DuplicateWindowSeconds + "s)");
                return ScanOutcome.Of(ScanOutcomeKind.Duplicate, barcode, null);
            }

            ScanRecord r = new ScanRecord();
            r.ClientScanId = ScanIdGenerator.NewId(_config.DeviceId, now);
            r.DeviceId = _config.DeviceId;
            r.OperatorId = operatorId;
            r.OperatorName = _state.OperatorName;
            r.SessionId = sessionId;
            r.SessionName = _state.SessionName;
            r.Barcode = barcode;
            r.RawBarcode = raw;
            r.ScannedAtDevice = Util.FormatLocal(now);
            r.CreatedAtLocal = r.ScannedAtDevice;
            r.Status = ScanStatus.Pending;

            try
            {
                _store.Append(r);
            }
            catch (Exception ex)
            {
                // Not saved: the operator must NOT see a confirmation.
                Logger.Error("scan NOT saved locally", ex);
                return ScanOutcome.Of(ScanOutcomeKind.Error, barcode, "FALHA AO SALVAR");
            }

            _duplicates.Register(key, nowTicks);
            Logger.Info("scan saved locally id=" + r.ClientScanId);
            ScanOutcome outcome = ScanOutcome.Of(ScanOutcomeKind.Saved, barcode, null);
            outcome.Record = r;
            return outcome;
        }
    }
}
