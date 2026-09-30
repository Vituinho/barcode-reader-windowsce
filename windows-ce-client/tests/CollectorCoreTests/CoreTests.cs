using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using GivovaCollector.Core;

namespace GivovaCollector.Tests
{
    public static class CoreTests
    {
        public static ScanRecord NewRecord(string barcode)
        {
            ScanRecord r = new ScanRecord();
            r.ClientScanId = ScanIdGenerator.NewId("GVT-CE-001", DateTime.Now);
            r.DeviceId = "GVT-CE-001";
            r.OperatorId = "11111111-1111-1111-1111-111111111111";
            r.OperatorName = "Operador";
            r.SessionId = "22222222-2222-2222-2222-222222222222";
            r.SessionName = "RECEBIMENTO TESTE";
            r.Barcode = barcode;
            r.RawBarcode = barcode + "\r";
            r.ScannedAtDevice = Util.FormatLocal(DateTime.Now);
            r.CreatedAtLocal = r.ScannedAtDevice;
            return r;
        }

        public static void Register()
        {
            TestRunner.Add("queue persists across restart", delegate
            {
                string dir = Assert.TempDir();
                JournalScanStore store = new JournalScanStore(dir);
                store.Open();
                for (int i = 0; i < 10; i++) store.Append(NewRecord("789000000000" + i));
                JournalScanStore reopened = new JournalScanStore(dir);
                reopened.Open();
                Assert.Equal(10, reopened.PendingCount, "pending after restart");
                List<ScanRecord> pending = reopened.GetPending(100);
                Assert.Equal("7890000000000", pending[0].Barcode, "order preserved (first)");
                Assert.Equal("7890000000009", pending[9].Barcode, "order preserved (last)");
            });

            TestRunner.Add("pending -> synced transition persists; failed attempts counted", delegate
            {
                string dir = Assert.TempDir();
                JournalScanStore store = new JournalScanStore(dir);
                store.Open();
                ScanRecord a = NewRecord("A1");
                ScanRecord b = NewRecord("B1");
                store.Append(a);
                store.Append(b);
                store.MarkAttemptFailed(a.ClientScanId, "timeout");
                store.MarkAttemptFailed(a.ClientScanId, "timeout");
                store.MarkSynced(a.ClientScanId, "srv-1", "KNOWN", "Item A");
                store.MarkRejected(b.ClientScanId, "BARCODE_TOO_LONG");

                JournalScanStore reopened = new JournalScanStore(dir);
                reopened.Open();
                ScanRecord ra = reopened.Get(a.ClientScanId);
                Assert.Equal(ScanStatus.Synced, ra.Status, "a synced");
                Assert.Equal(3, ra.SyncAttempts, "attempts counted");
                Assert.Equal("Item A", ra.ItemName, "item name kept");
                Assert.Equal(ScanStatus.Rejected, reopened.Get(b.ClientScanId).Status, "b rejected (kept, not deleted)");
                Assert.Equal(0, reopened.PendingCount, "nothing pending");
                Assert.Equal(1, reopened.RequeueRejected(), "requeue");
                Assert.Equal(1, reopened.PendingCount, "b pending again");
            });

            TestRunner.Add("barcode characters survive journal roundtrip", delegate
            {
                string dir = Assert.TempDir();
                JournalScanStore store = new JournalScanStore(dir);
                store.Open();
                string[] codes = new string[] { "0001234", "abc|DEF\\x", "]C1" + "\x1D" + "0107891234567890", "Colchão 5%", "  spaced  " };
                List<string> ids = new List<string>();
                foreach (string code in codes)
                {
                    ScanRecord r = NewRecord(code);
                    store.Append(r);
                    ids.Add(r.ClientScanId);
                }
                JournalScanStore reopened = new JournalScanStore(dir);
                reopened.Open();
                for (int i = 0; i < codes.Length; i++)
                {
                    Assert.Equal(codes[i], reopened.Get(ids[i]).Barcode, "barcode " + i);
                    Assert.Equal(codes[i] + "\r", reopened.Get(ids[i]).RawBarcode, "raw " + i);
                }
            });

            TestRunner.Add("corrupt and torn journal lines are skipped, rest recovered", delegate
            {
                string dir = Assert.TempDir();
                JournalScanStore store = new JournalScanStore(dir);
                store.Open();
                store.Append(NewRecord("GOOD-1"));
                string journal = Path.Combine(dir, "scans.journal");
                AppendRaw(journal, "R1|garbage|line|0000\n");          // bad checksum
                store.Append(NewRecord("GOOD-2"));
                AppendRaw(journal, "R1|torn-line-without-newline-and-crc"); // power loss mid-write

                JournalScanStore reopened = new JournalScanStore(dir);
                reopened.Open();
                Assert.Equal(2, reopened.PendingCount, "valid records recovered");
                Assert.Equal(2, reopened.CorruptLinesSkipped, "corrupt lines counted");
                reopened.Append(NewRecord("GOOD-3")); // must start on a fresh line
                JournalScanStore again = new JournalScanStore(dir);
                again.Open();
                Assert.Equal(3, again.PendingCount, "append after torn line is readable");
            });

            TestRunner.Add("compaction drops only confirmed records from previous days", delegate
            {
                string dir = Assert.TempDir();
                JournalScanStore store = new JournalScanStore(dir);
                store.Open();
                ScanRecord oldSynced = NewRecord("OLD-SYNCED");
                oldSynced.CreatedAtLocal = "2026-09-01T10:00:00";
                ScanRecord oldPending = NewRecord("OLD-PENDING");
                oldPending.CreatedAtLocal = "2026-09-01T10:00:01";
                ScanRecord todaySynced = NewRecord("TODAY-SYNCED");
                store.Append(oldSynced);
                store.Append(oldPending);
                store.Append(todaySynced);
                store.MarkSynced(oldSynced.ClientScanId, "s1", "KNOWN", null);
                store.MarkSynced(todaySynced.ClientScanId, "s2", "KNOWN", null);
                store.Compact(DateTime.Today);

                JournalScanStore reopened = new JournalScanStore(dir);
                reopened.Open();
                Assert.True(reopened.Get(oldSynced.ClientScanId) == null, "old synced removed");
                Assert.True(reopened.Get(oldPending.ClientScanId) != null, "old pending kept");
                Assert.True(reopened.Get(todaySynced.ClientScanId) != null, "today's synced kept");
            });

            TestRunner.Add("interrupted compaction is recovered from backup", delegate
            {
                string dir = Assert.TempDir();
                JournalScanStore store = new JournalScanStore(dir);
                store.Open();
                store.Append(NewRecord("X1"));
                store.Append(NewRecord("X2"));
                string journal = Path.Combine(dir, "scans.journal");
                // Simulate crash after "journal -> .bak" and a half-written tmp file.
                File.Move(journal, journal + ".bak");
                File.WriteAllText(journal + ".tmp", "R1|half");
                JournalScanStore reopened = new JournalScanStore(dir);
                reopened.Open();
                Assert.Equal(2, reopened.PendingCount, "records restored from .bak");
                Assert.True(!File.Exists(journal + ".tmp"), "tmp removed");
            });

            TestRunner.Add("scan ids are unique and carry the device id", delegate
            {
                Dictionary<string, bool> seen = new Dictionary<string, bool>();
                DateTime now = DateTime.Now;
                for (int i = 0; i < 20000; i++)
                {
                    string id = ScanIdGenerator.NewId("GVT-CE-001", now);
                    Assert.True(!seen.ContainsKey(id), "unique id");
                    seen[id] = true;
                }
                string sample = ScanIdGenerator.NewId("GVT-CE-001", now);
                Assert.True(sample.StartsWith("GVT-CE-001-"), "prefix");
                Assert.True(sample.Length <= 100, "fits server column");
            });

            TestRunner.Add("barcode terminator cleanup preserves value", delegate
            {
                Assert.Equal("7891234567890", BarcodeCleaner.Clean("7891234567890\r"), "CR");
                Assert.Equal("7891234567890", BarcodeCleaner.Clean("7891234567890\r\n"), "CRLF");
                Assert.Equal("ABC-123", BarcodeCleaner.Clean("ABC-123\t"), "TAB");
                Assert.Equal("0001", BarcodeCleaner.Clean("\x02" + "0001" + "\x03"), "STX/ETX");
                Assert.Equal("00123", BarcodeCleaner.Clean("00123"), "leading zeroes");
                Assert.Equal("aBc dEf", BarcodeCleaner.Clean("aBc dEf\r"), "case and inner space");
                Assert.Equal("01" + "\x1D" + "10ABC", BarcodeCleaner.Clean("01" + "\x1D" + "10ABC\r"), "GS1 separator kept");
                Assert.Equal("", BarcodeCleaner.Clean("\r"), "empty");
                Assert.Equal("", BarcodeCleaner.Clean("   \r"), "whitespace only");
                Assert.Equal("", BarcodeCleaner.Clean(null), "null");
            });

            TestRunner.Add("duplicate detector window", delegate
            {
                DuplicateDetector d = new DuplicateDetector(2);
                string key = DuplicateDetector.Key("D", "O", "S", "789");
                Assert.True(!d.IsDuplicate(key, 1000), "first scan");
                d.Register(key, 1000);
                Assert.True(d.IsDuplicate(key, 2500), "1.5s later -> duplicate");
                Assert.True(!d.IsDuplicate(key, 3000), "2s later -> valid again");
                Assert.True(!d.IsDuplicate(DuplicateDetector.Key("D", "O", "S2", "789"), 1500), "other session");
                d.Register(key, int.MaxValue - 500);
                Assert.True(d.IsDuplicate(key, unchecked(int.MaxValue + 500)), "TickCount wrap-around");
                d.WindowSeconds = 0;
                Assert.True(!d.IsDuplicate(key, int.MaxValue - 400), "window 0 disables");
            });

            TestRunner.Add("processor saves before confirming, ignores empty, flags double trigger", delegate
            {
                string dir = Assert.TempDir();
                JournalScanStore store = new JournalScanStore(dir);
                store.Open();
                ScanProcessor p = NewProcessor(store, dir);
                Assert.Equal(ScanOutcomeKind.Ignored, p.Process("\r", DateTime.Now, 0).Kind, "empty ignored");
                ScanOutcome first = p.Process("7891234567890\r", DateTime.Now, 1000);
                Assert.Equal(ScanOutcomeKind.Saved, first.Kind, "saved");
                Assert.True(store.Get(first.Record.ClientScanId) != null, "on disk before outcome");
                Assert.Equal(ScanOutcomeKind.Duplicate, p.Process("7891234567890\r", DateTime.Now, 1400).Kind, "double trigger");
                Assert.Equal(ScanOutcomeKind.Saved, p.Process("7891234567890\r", DateTime.Now, 5000).Kind, "later rescan valid");
                Assert.Equal(2, store.PendingCount, "two business scans");
            });

            TestRunner.Add("processor reports error (no confirmation) when local save fails", delegate
            {
                string dir = Assert.TempDir();
                ScanProcessor p = NewProcessor(new FailingStore(), dir);
                ScanOutcome o = p.Process("123\r", DateTime.Now, 0);
                Assert.Equal(ScanOutcomeKind.Error, o.Kind, "error outcome");
                Assert.True(o.Record == null, "no record confirmed");
            });

            TestRunner.Add("json roundtrip", delegate
            {
                string json = new JsonObjectBuilder().Add("barcode", "00\"7\\8\r\nÇ").Add("n", 5).Add("ok", true)
                    .Add("none", (string)null).ToString();
                Dictionary<string, object> o = Json.ParseObject(json);
                Assert.Equal("00\"7\\8\r\nÇ", Json.GetString(o, "barcode"), "string escapes");
                Assert.Equal(5, Json.GetInt(o, "n", 0), "number");
                Assert.True(Json.GetBool(o, "ok", false), "bool");
                Assert.True(Json.GetString(o, "none") == null, "null");
                object arr = Json.Parse("[{\"a\":[1,2,{\"b\":null}]}, \"x\", -1.5e2]");
                Assert.Equal(3, ((List<object>)arr).Count, "array");
                bool threw = false;
                try { Json.Parse("{\"a\":"); } catch (FormatException) { threw = true; }
                Assert.True(threw, "malformed JSON rejected");
            });

            TestRunner.Add("config and state survive reload; PIN hashed", delegate
            {
                string dir = Assert.TempDir();
                AppConfig c = AppConfig.Load(Path.Combine(dir, "collector.ini"));
                Assert.True(c.CheckPin(AppConfig.DefaultPin), "default PIN before setup");
                c.DeviceId = "GVT-CE-002";
                c.ApiBaseUrl = "http://10.0.0.5:8000";
                c.SetPin("9876");
                c.Save();
                AppConfig loaded = AppConfig.Load(Path.Combine(dir, "collector.ini"));
                Assert.Equal("GVT-CE-002", loaded.DeviceId, "device id");
                Assert.True(loaded.CheckPin("9876") && !loaded.CheckPin("1234"), "pin");
                Assert.True(loaded.AdminPinHash.IndexOf("9876") < 0, "pin not stored in clear");

                AppState s = new AppState(Path.Combine(dir, "state.ini"));
                s.SetLogin("op", "op-id", "Operador", "token-abc", DateTime.UtcNow.AddHours(1));
                s.SetSession("sess-1", "CARGA 1");
                AppState s2 = new AppState(Path.Combine(dir, "state.ini"));
                s2.Load();
                Assert.Equal("token-abc", s2.UsableToken, "token restored after restart");
                Assert.Equal("CARGA 1", s2.SessionName, "session restored");
                s2.Logout();
                Assert.True(s2.UsableToken == null && !s2.HasOperator && s2.HasSession, "logout clears operator only");
            });
        }

        public static ScanProcessor NewProcessor(ILocalScanStore store, string dir)
        {
            AppConfig config = AppConfig.Load(Path.Combine(dir, "collector.ini"));
            config.DeviceId = "GVT-CE-001";
            config.DuplicateWindowSeconds = 2;
            AppState state = new AppState(Path.Combine(dir, "state.ini"));
            state.SetLogin("op", "11111111-1111-1111-1111-111111111111", "Operador", "tok", DateTime.UtcNow.AddHours(1));
            state.SetSession("22222222-2222-2222-2222-222222222222", "RECEBIMENTO TESTE");
            return new ScanProcessor(store, config, state);
        }

        private static void AppendRaw(string path, string text)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            using (FileStream fs = new FileStream(path, FileMode.Append, FileAccess.Write))
            {
                fs.Write(bytes, 0, bytes.Length);
            }
        }

        private class FailingStore : ILocalScanStore
        {
            public void Open() { }
            public void Append(ScanRecord record) { throw new IOException("disk full"); }
            public void MarkSynced(string id, string s, string r, string i) { }
            public void MarkConflict(string id, string s, string r, string m) { }
            public void MarkAttemptFailed(string id, string e) { }
            public void MarkRejected(string id, string e) { }
            public int RequeueRejected() { return 0; }
            public List<ScanRecord> GetPending(int max) { return new List<ScanRecord>(); }
            public List<ScanRecord> GetProblems(int max) { return new List<ScanRecord>(); }
            public ScanRecord Get(string id) { return null; }
            public int PendingCount { get { return 0; } }
            public int CountByStatus(string status) { return 0; }
            public int CountCreatedOn(DateTime day) { return 0; }
            public bool NeedsCompaction(DateTime today) { return false; }
            public void Compact(DateTime today) { }
        }
    }
}
