using System;
using System.Collections.Generic;
using GivovaCollector.Core;

namespace GivovaCollector.Net
{
    public enum ApiErrorKind
    {
        /// <summary>DNS failure, connection refused, Wi-Fi down, timeout. Retry later.</summary>
        Network,
        /// <summary>HTTP 5xx, 404, 408, 429, non-API error pages or unexpected status. Retry later.</summary>
        Server,
        /// <summary>2xx with unreadable body. Retry (the server call is idempotent).</summary>
        BadResponse,
        /// <summary>HTTP 401: token missing/expired. Operator must log in again.</summary>
        Unauthorized,
        /// <summary>HTTP 403: device disabled / not registered / mismatch.</summary>
        Forbidden,
        /// <summary>HTTP 400/409/413/422 from our API: this request will never succeed as is.</summary>
        Rejected
    }

    public class ApiException : Exception
    {
        public readonly ApiErrorKind Kind;
        public readonly int StatusCode;
        public readonly string ErrorCode;

        public ApiException(ApiErrorKind kind, int statusCode, string errorCode, string message)
            : base(message)
        {
            Kind = kind;
            StatusCode = statusCode;
            ErrorCode = errorCode;
        }

        public bool IsRetryable
        {
            get { return Kind == ApiErrorKind.Network || Kind == ApiErrorKind.Server || Kind == ApiErrorKind.BadResponse; }
        }
    }

    public class LoginResult
    {
        public string Token;
        public DateTime ExpiresUtc;
        public string UserId;
        public string FullName;
        public string Role;
    }

    public class SessionInfo
    {
        public string Id;
        public string Name;
        public string SessionType;

        public override string ToString() { return Name; }
    }

    public class ScanApiResult
    {
        public bool Accepted;
        public string Result;
        public string ServerScanId;
        public string ItemName;
        public bool Replayed;
        public string Error;
        public string Message;
    }

    public class DeviceConfigInfo
    {
        public string DeviceName;
        public string Status;
        public int SyncIntervalSeconds;
        public int DuplicateWindowSeconds;
    }

    public class HeartbeatInfo
    {
        public string DeviceId;
        public string AppVersion;
        public string OperatorId;
        public int BatteryLevel = -1;
        public int PendingScans;
        public DateTime Timestamp;
    }

    /// <summary>Server API used by the collector. Implementations throw ApiException on failure.</summary>
    public interface IScanApi
    {
        void Ping();
        LoginResult Login(string username, string password, string deviceId);
        List<SessionInfo> GetOpenSessions(string token);
        ScanApiResult SendScan(ScanRecord record, string token);
        void SendHeartbeat(HeartbeatInfo info, string token);
        DeviceConfigInfo GetDeviceConfig(string deviceId, string token);
    }
}
