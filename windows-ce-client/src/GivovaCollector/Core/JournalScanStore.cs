using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using GivovaCollector.Platform;

namespace GivovaCollector.Core
{
    /// <summary>
    /// Append-only journal file. Every change writes one full record snapshot line:
    ///   R1|field|field|...|crc32
    /// The last valid line for a clientScanId wins. Lines with a bad checksum (torn write after
    /// power loss, flash corruption) are skipped individually, so one bad line never loses the rest.
    /// Compaction rewrites the file through tmp/bak files so a crash at any step is recoverable.
    /// </summary>
    public class JournalScanStore : ILocalScanStore
    {
        private const string Magic = "R1";
        private const int FieldCount = 18; // without checksum

        private readonly object _sync = new object();
        private readonly string _dir;
        private readonly string _journalPath;
        private readonly string _tmpPath;
        private readonly string _bakPath;

        private readonly Dictionary<string, ScanRecord> _byId = new Dictionary<string, ScanRecord>();
        private readonly List<ScanRecord> _order = new List<ScanRecord>();
        private bool _needsNewline;
        private int _linesInFile;
        private int _corruptLines;

        public JournalScanStore(string dataDirectory)
        {
            _dir = dataDirectory;
            _journalPath = Path.Combine(dataDirectory, "scans.journal");
            _tmpPath = _journalPath + ".tmp";
            _bakPath = _journalPath + ".bak";
        }

        /// <summary>Number of unreadable lines skipped during the last Open().</summary>
        public int CorruptLinesSkipped { get { lock (_sync) return _corruptLines; } }

        public int TotalRecords { get { lock (_sync) return _order.Count; } }

        public void Open()
        {
            lock (_sync)
            {
                if (!Directory.Exists(_dir)) Directory.CreateDirectory(_dir);
                RecoverInterruptedCompaction();
                _byId.Clear();
                _order.Clear();
                _corruptLines = 0;
                _linesInFile = 0;
                _needsNewline = false;
                if (File.Exists(_journalPath)) Load();
                Logger.Info("queue loaded: records=" + _order.Count + " pending=" + CountByStatusLocked(ScanStatus.Pending)
                            + " corruptLines=" + _corruptLines);
            }
        }

        private void RecoverInterruptedCompaction()
        {
            if (!File.Exists(_journalPath) && File.Exists(_bakPath))
            {
                File.Move(_bakPath, _journalPath);
                Logger.Warn("journal restored from backup after interrupted compaction");
            }
            else if (File.Exists(_bakPath))
            {
                File.Delete(_bakPath);
            }
            if (File.Exists(_tmpPath)) File.Delete(_tmpPath);
        }

        private void Load()
        {
            byte[] data;
            using (FileStream fs = new FileStream(_journalPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                data = new byte[(int)fs.Length];
                int read = 0;
                while (read < data.Length)
                {
                    int n = fs.Read(data, read, data.Length - read);
                    if (n <= 0) break;
                    read += n;
                }
            }
            if (data.Length > 0 && data[data.Length - 1] != (byte)'\n') _needsNewline = true;

            int start = 0;
            for (int i = 0; i <= data.Length; i++)
            {
                if (i < data.Length && data[i] != (byte)'\n') continue;
                int len = i - start;
                if (len > 0 && data[start + len - 1] == (byte)'\r') len--;
                if (len > 0)
                {
                    _linesInFile++;
                    ScanRecord r = ParseLine(Encoding.UTF8.GetString(data, start, len));
                    if (r == null) _corruptLines++;
                    else Upsert(r);
                }
                start = i + 1;
            }
            if (_corruptLines > 0) Logger.Warn("journal: skipped " + _corruptLines + " corrupt line(s)");
        }

        private void Upsert(ScanRecord r)
        {
            ScanRecord existing;
            if (_byId.TryGetValue(r.ClientScanId, out existing))
            {
                int index = _order.IndexOf(existing);
                _order[index] = r;
            }
            else
            {
                _order.Add(r);
            }
            _byId[r.ClientScanId] = r;
        }

        // ---- writes -------------------------------------------------------------------------

        public void Append(ScanRecord record)
        {
            if (record == null || string.IsNullOrEmpty(record.ClientScanId)) throw new ArgumentException("clientScanId required");
            if (string.IsNullOrEmpty(record.Barcode)) throw new ArgumentException("barcode required");
            lock (_sync)
            {
                if (_byId.ContainsKey(record.ClientScanId)) throw new InvalidOperationException("duplicate clientScanId");
                ScanRecord copy = record.Clone();
                copy.Status = ScanStatus.Pending;
                WriteLines(new ScanRecord[] { copy }, _journalPath, true);
                Upsert(copy);
            }
        }

        public void MarkSynced(string clientScanId, string serverScanId, string serverResult, string itemName)
        {
            Update(clientScanId, ScanStatus.Synced, serverScanId, serverResult, itemName, null, false);
        }

        public void MarkConflict(string clientScanId, string serverScanId, string serverResult, string message)
        {
            Update(clientScanId, ScanStatus.Conflict, serverScanId, serverResult, null, message, false);
        }

        public void MarkAttemptFailed(string clientScanId, string error)
        {
            Update(clientScanId, ScanStatus.Pending, null, null, null, error, true);
        }

        public void MarkRejected(string clientScanId, string error)
        {
            Update(clientScanId, ScanStatus.Rejected, null, null, null, error, true);
        }

        private void Update(string id, string status, string serverScanId, string result, string itemName,
                            string error, bool countAttemptOnly)
        {
            lock (_sync)
            {
                ScanRecord current;
                if (!_byId.TryGetValue(id, out current)) return;
                ScanRecord next = current.Clone();
                next.Status = status;
                next.SyncAttempts = current.SyncAttempts + 1;
                next.LastSyncAttempt = Util.FormatLocal(DateTime.Now);
                next.LastError = error;
                if (!countAttemptOnly)
                {
                    next.ServerScanId = serverScanId;
                    next.ServerResult = result;
                    if (itemName != null) next.ItemName = itemName;
                }
                WriteLines(new ScanRecord[] { next }, _journalPath, true);
                Upsert(next);
            }
        }

        public int RequeueRejected()
        {
            lock (_sync)
            {
                List<ScanRecord> changed = new List<ScanRecord>();
                foreach (ScanRecord r in _order)
                {
                    if (r.Status != ScanStatus.Rejected) continue;
                    ScanRecord next = r.Clone();
                    next.Status = ScanStatus.Pending;
                    changed.Add(next);
                }
                if (changed.Count == 0) return 0;
                WriteLines(changed.ToArray(), _journalPath, true);
                foreach (ScanRecord r in changed) Upsert(r);
                return changed.Count;
            }
        }

        private void WriteLines(ScanRecord[] records, string path, bool append)
        {
            StringBuilder sb = new StringBuilder(records.Length * 256);
            if (append && _needsNewline) sb.Append('\n');
            foreach (ScanRecord r in records)
            {
                string body = Serialize(r);
                sb.Append(body).Append('|').Append(Crc32.Hex(body)).Append('\n');
            }
            byte[] bytes = Encoding.UTF8.GetBytes(sb.ToString());
            using (FileStream fs = new FileStream(path, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read))
            {
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush();
                DeviceServices.FlushToStorage(fs);
            }
            if (append)
            {
                _needsNewline = false;
                _linesInFile += records.Length;
            }
        }

        // ---- reads --------------------------------------------------------------------------

        public List<ScanRecord> GetPending(int max)
        {
            lock (_sync)
            {
                List<ScanRecord> list = new List<ScanRecord>();
                foreach (ScanRecord r in _order)
                {
                    if (r.Status != ScanStatus.Pending) continue;
                    list.Add(r.Clone());
                    if (list.Count >= max) break;
                }
                return list;
            }
        }

        public List<ScanRecord> GetProblems(int max)
        {
            lock (_sync)
            {
                List<ScanRecord> list = new List<ScanRecord>();
                for (int i = _order.Count - 1; i >= 0 && list.Count < max; i--)
                {
                    if (_order[i].Status != ScanStatus.Synced) list.Add(_order[i].Clone());
                }
                return list;
            }
        }

        public ScanRecord Get(string clientScanId)
        {
            lock (_sync)
            {
                ScanRecord r;
                return _byId.TryGetValue(clientScanId, out r) ? r.Clone() : null;
            }
        }

        public int PendingCount { get { return CountByStatus(ScanStatus.Pending); } }

        public int CountByStatus(string status)
        {
            lock (_sync) return CountByStatusLocked(status);
        }

        private int CountByStatusLocked(string status)
        {
            int n = 0;
            foreach (ScanRecord r in _order) if (r.Status == status) n++;
            return n;
        }

        public int CountCreatedOn(DateTime day)
        {
            string prefix = day.ToString("yyyy-MM-dd");
            lock (_sync)
            {
                int n = 0;
                foreach (ScanRecord r in _order)
                {
                    if (r.ServerResult == "DUPLICATE") continue;
                    if (r.CreatedAtLocal != null && r.CreatedAtLocal.StartsWith(prefix)) n++;
                }
                return n;
            }
        }

        // ---- compaction ---------------------------------------------------------------------

        /// <summary>True when the journal holds many superseded lines or old confirmed records.</summary>
        public bool NeedsCompaction(DateTime today)
        {
            lock (_sync)
            {
                if (_linesInFile > _order.Count * 2 + 500) return true;
                return CountRemovableLocked(today) > 1000;
            }
        }

        private int CountRemovableLocked(DateTime today)
        {
            int n = 0;
            foreach (ScanRecord r in _order) if (IsRemovable(r, today)) n++;
            return n;
        }

        private static bool IsRemovable(ScanRecord r, DateTime today)
        {
            // Only records the server already holds, and only from previous days.
            if (r.Status != ScanStatus.Synced && r.Status != ScanStatus.Conflict) return false;
            string prefix = today.ToString("yyyy-MM-dd");
            return r.CreatedAtLocal == null || !r.CreatedAtLocal.StartsWith(prefix);
        }

        public void Compact(DateTime today)
        {
            lock (_sync)
            {
                List<ScanRecord> keep = new List<ScanRecord>(_order.Count);
                foreach (ScanRecord r in _order) if (!IsRemovable(r, today)) keep.Add(r);

                WriteLines(keep.ToArray(), _tmpPath, false);
                if (File.Exists(_bakPath)) File.Delete(_bakPath);
                if (File.Exists(_journalPath)) File.Move(_journalPath, _bakPath);
                File.Move(_tmpPath, _journalPath);
                File.Delete(_bakPath);

                int removed = _order.Count - keep.Count;
                _order.Clear();
                _byId.Clear();
                foreach (ScanRecord r in keep) Upsert(r);
                _linesInFile = keep.Count;
                _needsNewline = false;
                Logger.Info("journal compacted: kept=" + keep.Count + " removed=" + removed);
            }
        }

        // ---- line format --------------------------------------------------------------------

        private static string Serialize(ScanRecord r)
        {
            string[] f = new string[]
            {
                Magic, r.ClientScanId, r.DeviceId, r.OperatorId, r.OperatorName, r.SessionId, r.SessionName,
                r.Barcode, r.RawBarcode, r.ScannedAtDevice, r.CreatedAtLocal, r.Status,
                r.SyncAttempts.ToString(), r.LastSyncAttempt, r.LastError, r.ServerScanId, r.ServerResult, r.ItemName
            };
            StringBuilder sb = new StringBuilder(256);
            for (int i = 0; i < f.Length; i++)
            {
                if (i > 0) sb.Append('|');
                Escape(sb, f[i]);
            }
            return sb.ToString();
        }

        internal static ScanRecord ParseLine(string line)
        {
            try
            {
                int bar = line.LastIndexOf('|');
                if (bar <= 0) return null;
                string body = line.Substring(0, bar);
                if (Crc32.Hex(body) != line.Substring(bar + 1)) return null;
                string[] f = body.Split('|');
                if (f.Length != FieldCount || f[0] != Magic) return null;
                ScanRecord r = new ScanRecord();
                r.ClientScanId = Unescape(f[1]);
                r.DeviceId = Unescape(f[2]);
                r.OperatorId = Unescape(f[3]);
                r.OperatorName = Unescape(f[4]);
                r.SessionId = Unescape(f[5]);
                r.SessionName = Unescape(f[6]);
                r.Barcode = Unescape(f[7]);
                r.RawBarcode = Unescape(f[8]);
                r.ScannedAtDevice = Unescape(f[9]);
                r.CreatedAtLocal = Unescape(f[10]);
                r.Status = Unescape(f[11]);
                r.SyncAttempts = Util.ParseInt(f[12], 0);
                r.LastSyncAttempt = Unescape(f[13]);
                r.LastError = Unescape(f[14]);
                r.ServerScanId = Unescape(f[15]);
                r.ServerResult = Unescape(f[16]);
                r.ItemName = Unescape(f[17]);
                if (string.IsNullOrEmpty(r.ClientScanId) || string.IsNullOrEmpty(r.Barcode)) return null;
                if (r.Status != ScanStatus.Pending && r.Status != ScanStatus.Synced &&
                    r.Status != ScanStatus.Conflict && r.Status != ScanStatus.Rejected) return null;
                return r;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static void Escape(StringBuilder sb, string value)
        {
            if (value == null) return; // null and "" are stored the same way
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c == '\\') sb.Append("\\\\");
                else if (c == '|') sb.Append("\\p");
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c < 0x20 || c == 0x7F) sb.Append("\\x").Append(((int)c).ToString("x2"));
                else sb.Append(c);
            }
        }

        private static string Unescape(string value)
        {
            if (value.Length == 0) return null;
            if (value.IndexOf('\\') < 0) return value;
            StringBuilder sb = new StringBuilder(value.Length);
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c != '\\') { sb.Append(c); continue; }
                char e = value[++i];
                if (e == '\\') sb.Append('\\');
                else if (e == 'p') sb.Append('|');
                else if (e == 'n') sb.Append('\n');
                else if (e == 'r') sb.Append('\r');
                else if (e == 'x') { sb.Append((char)Convert.ToInt32(value.Substring(i + 1, 2), 16)); i += 2; }
                else throw new FormatException("bad escape");
            }
            return sb.ToString();
        }
    }
}
