using System;
using System.Collections.Generic;

namespace GivovaCollector.Core
{
    /// <summary>
    /// Durable local scan queue. Append must not return until the record is on persistent storage;
    /// callers only confirm a scan to the operator after Append succeeded.
    /// Records are never deleted before the server confirmed them.
    /// </summary>
    public interface ILocalScanStore
    {
        void Open();

        /// <summary>Durably stores a new PENDING record. Throws on failure.</summary>
        void Append(ScanRecord record);

        void MarkSynced(string clientScanId, string serverScanId, string serverResult, string itemName);
        void MarkConflict(string clientScanId, string serverScanId, string serverResult, string message);
        void MarkAttemptFailed(string clientScanId, string error);
        void MarkRejected(string clientScanId, string error);

        /// <summary>Moves REJECTED records back to PENDING (manual retry). Returns how many.</summary>
        int RequeueRejected();

        /// <summary>Pending records in scan order (copies).</summary>
        List<ScanRecord> GetPending(int max);

        /// <summary>PENDING, REJECTED and CONFLICT records, newest first (copies).</summary>
        List<ScanRecord> GetProblems(int max);

        ScanRecord Get(string clientScanId);
        int PendingCount { get; }
        int CountByStatus(string status);
        int CountCreatedOn(DateTime day);

        bool NeedsCompaction(DateTime today);

        /// <summary>Drops confirmed records from previous days and rewrites the journal atomically.</summary>
        void Compact(DateTime today);
    }
}
