using System;

namespace GivovaCollector.Core
{
    /// <summary>Local sync states of a scan kept in the device queue.</summary>
    public static class ScanStatus
    {
        /// <summary>Saved locally, not yet confirmed by the server. Retried automatically.</summary>
        public const string Pending = "PENDING";
        /// <summary>Server confirmed storage (KNOWN, UNKNOWN or DUPLICATE).</summary>
        public const string Synced = "SYNCED";
        /// <summary>Server stored it but flagged a business conflict (e.g. SESSION_CLOSED).</summary>
        public const string Conflict = "CONFLICT";
        /// <summary>Server permanently refused it (validation). Kept locally; can be re-queued manually.</summary>
        public const string Rejected = "REJECTED";
    }

    public class ScanRecord
    {
        public string ClientScanId;
        public string DeviceId;
        public string OperatorId;
        public string OperatorName;
        public string SessionId;
        public string SessionName;
        /// <summary>Cleaned value (terminators removed). Opaque text, never converted to a number.</summary>
        public string Barcode;
        /// <summary>Exactly what the scanner delivered, including terminator characters.</summary>
        public string RawBarcode;
        /// <summary>Device wall-clock time of the physical scan (yyyy-MM-ddTHH:mm:ss).</summary>
        public string ScannedAtDevice;
        public string CreatedAtLocal;

        public string Status = ScanStatus.Pending;
        public int SyncAttempts;
        public string LastSyncAttempt;
        public string LastError;
        public string ServerScanId;
        /// <summary>Server result: KNOWN, UNKNOWN, DUPLICATE, SESSION_CLOSED, ...</summary>
        public string ServerResult;
        public string ItemName;

        public bool IsPending { get { return Status == ScanStatus.Pending; } }

        public ScanRecord Clone()
        {
            return (ScanRecord)MemberwiseClone();
        }

        public DateTime CreatedAt { get { return Util.ParseLocal(CreatedAtLocal); } }
    }
}
