using System;
using System.Collections.Generic;
using System.IO;
using GivovaCollector.Core;
using GivovaCollector.Net;

namespace GivovaCollector.Tests
{
    public static class SyncTests
    {
        /// <summary>Scriptable API: each SendScan pops the next behavior (default: accept KNOWN).</summary>
        private class FakeApi : IScanApi
        {
            public readonly Queue<string> Script = new Queue<string>();
            public readonly List<string> Sent = new List<string>();
            public bool PingFails;

            public void Ping()
            {
                if (PingFails) throw new ApiException(ApiErrorKind.Network, 0, "ConnectFailure", "offline");
            }

            public LoginResult Login(string u, string p, string d) { throw new NotSupportedException(); }
            public List<SessionInfo> GetOpenSessions(string t) { return new List<SessionInfo>(); }
            public void SendHeartbeat(HeartbeatInfo info, string token) { }
            public DeviceConfigInfo GetDeviceConfig(string d, string t) { return new DeviceConfigInfo(); }

            public ScanApiResult SendScan(ScanRecord record, string token)
            {
                Sent.Add(record.ClientScanId);
                string step = Script.Count > 0 ? Script.Dequeue() : "KNOWN";
                switch (step)
                {
                    case "NETWORK": throw new ApiException(ApiErrorKind.Network, 0, "Timeout", "timeout");
                    case "500": throw new ApiException(ApiErrorKind.Server, 500, "INTERNAL_ERROR", "erro");
                    case "BAD": throw new ApiException(ApiErrorKind.BadResponse, 200, null, "invalid JSON");
                    case "401": throw new ApiException(ApiErrorKind.Unauthorized, 401, "TOKEN_EXPIRED", "expired");
                    case "403": throw new ApiException(ApiErrorKind.Forbidden, 403, "DEVICE_DISABLED", "disabled");
                    case "422": throw new ApiException(ApiErrorKind.Rejected, 422, "BARCODE_TOO_LONG", "too long");
                }
                ScanApiResult r = new ScanApiResult();
                r.Accepted = true;
                r.Result = step;
                r.ServerScanId = "srv-" + record.ClientScanId;
                r.ItemName = step == "KNOWN" ? "Item" : null;
                return r;
            }
        }

        private class Fixture
        {
            public JournalScanStore Store;
            public FakeApi Api = new FakeApi();
            public SyncService Sync;
            public AppState State;
            public List<ScanRecord> Records = new List<ScanRecord>();
        }

        private static Fixture Setup(int records)
        {
            Fixture f = new Fixture();
            string dir = Assert.TempDir();
            f.Store = new JournalScanStore(dir);
            f.Store.Open();
            for (int i = 0; i < records; i++)
            {
                ScanRecord r = CoreTests.NewRecord("CODE-" + i);
                f.Store.Append(r);
                f.Records.Add(r);
            }
            AppConfig config = AppConfig.Load(Path.Combine(dir, "collector.ini"));
            config.DeviceId = "GVT-CE-001";
            f.State = new AppState(Path.Combine(dir, "state.ini"));
            f.State.SetLogin("op", "11111111-1111-1111-1111-111111111111", "Operador", "tok", DateTime.UtcNow.AddHours(1));
            f.Sync = new SyncService(f.Store, f.Api, config, f.State, "test");
            return f;
        }

        public static void Register()
        {
            TestRunner.Add("sync: success marks records synced in order", delegate
            {
                Fixture f = Setup(3);
                f.Sync.RunOnce();
                Assert.Equal(0, f.Store.PendingCount, "all synced");
                Assert.Equal(f.Records[0].ClientScanId, f.Api.Sent[0], "order");
                Assert.Equal(ConnectionState.Online, f.Sync.Connection, "online");
                Assert.Equal("Item", f.Store.Get(f.Records[0].ClientScanId).ItemName, "item name stored");
            });

            TestRunner.Add("sync: network failure keeps record pending, stops pass, counts attempt", delegate
            {
                Fixture f = Setup(3);
                f.Api.Script.Enqueue("KNOWN");
                f.Api.Script.Enqueue("NETWORK");
                f.Sync.RunOnce();
                Assert.Equal(2, f.Store.PendingCount, "failed + untouched remain pending");
                Assert.Equal(2, f.Api.Sent.Count, "pass stopped at first failure");
                Assert.Equal(1, f.Store.Get(f.Records[1].ClientScanId).SyncAttempts, "attempt recorded");
                Assert.Equal(ConnectionState.Offline, f.Sync.Connection, "offline");
                f.Sync.RunOnce(); // connectivity back
                Assert.Equal(0, f.Store.PendingCount, "retry succeeded");
                Assert.Equal(f.Records[1].ClientScanId, f.Api.Sent[2], "retry resends the same clientScanId");
            });

            TestRunner.Add("sync: server error and malformed response are retried, never dropped", delegate
            {
                Fixture f = Setup(1);
                f.Api.Script.Enqueue("500");
                f.Sync.RunOnce();
                Assert.Equal(ConnectionState.ServerError, f.Sync.Connection, "server error state");
                f.Api.Script.Enqueue("BAD");
                f.Sync.RunOnce();
                Assert.Equal(1, f.Store.PendingCount, "still pending");
                f.Sync.RunOnce();
                Assert.Equal(0, f.Store.PendingCount, "eventually synced");
            });

            TestRunner.Add("sync: 401 requires login and keeps the queue", delegate
            {
                Fixture f = Setup(2);
                f.Api.Script.Enqueue("401");
                f.Sync.RunOnce();
                Assert.Equal(ConnectionState.LoginRequired, f.Sync.Connection, "login required");
                Assert.Equal(2, f.Store.PendingCount, "queue intact");
                Assert.True(f.State.UsableToken == null, "token invalidated");
                int sent = f.Api.Sent.Count;
                f.Sync.RunOnce();
                Assert.Equal(sent, f.Api.Sent.Count, "no calls without a login");
                f.State.SetLogin("op", "11111111-1111-1111-1111-111111111111", "Operador", "tok2", DateTime.UtcNow.AddHours(1));
                f.Sync.RunOnce();
                Assert.Equal(0, f.Store.PendingCount, "synced after re-login");
            });

            TestRunner.Add("sync: 403 device disabled blocks but keeps pending", delegate
            {
                Fixture f = Setup(1);
                f.Api.Script.Enqueue("403");
                f.Sync.RunOnce();
                Assert.Equal(ConnectionState.DeviceBlocked, f.Sync.Connection, "blocked");
                Assert.Equal(1, f.Store.PendingCount, "kept");
            });

            TestRunner.Add("sync: validation rejection is kept locally and does not block the queue", delegate
            {
                Fixture f = Setup(2);
                f.Api.Script.Enqueue("422");
                f.Sync.RunOnce();
                Assert.Equal(ScanStatus.Rejected, f.Store.Get(f.Records[0].ClientScanId).Status, "rejected kept");
                Assert.Equal(ScanStatus.Synced, f.Store.Get(f.Records[1].ClientScanId).Status, "next still synced");
            });

            TestRunner.Add("sync: closed session conflict is stored as CONFLICT", delegate
            {
                Fixture f = Setup(1);
                f.Api.Script.Enqueue("SESSION_CLOSED");
                f.Sync.RunOnce();
                ScanRecord r = f.Store.Get(f.Records[0].ClientScanId);
                Assert.Equal(ScanStatus.Conflict, r.Status, "conflict");
                Assert.Equal("SESSION_CLOSED", r.ServerResult, "server result");
            });

            TestRunner.Add("sync: offline ping keeps state offline without pending records", delegate
            {
                Fixture f = Setup(0);
                f.Api.PingFails = true;
                f.Sync.RunOnce();
                Assert.Equal(ConnectionState.Offline, f.Sync.Connection, "offline");
                f.Api.PingFails = false;
                f.Sync.RunOnce();
                Assert.Equal(ConnectionState.Online, f.Sync.Connection, "online again");
            });

            TestRunner.Add("sync: background thread drains queue and stops cleanly", delegate
            {
                Fixture f = Setup(5);
                f.Sync.Start();
                for (int i = 0; i < 50 && f.Store.PendingCount > 0; i++) System.Threading.Thread.Sleep(100);
                f.Sync.Stop();
                Assert.Equal(0, f.Store.PendingCount, "drained by thread");
            });
        }
    }
}
