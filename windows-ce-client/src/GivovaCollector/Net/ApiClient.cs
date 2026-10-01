using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using GivovaCollector.Core;
using GivovaCollector.Platform;

namespace GivovaCollector.Net
{
    /// <summary>
    /// HttpWebRequest-based client (available on .NET CF 2.0/3.5). Synchronous by design:
    /// call it only from worker threads, never from the UI thread.
    /// TLS: uses whatever the OS supports; certificate validation is never disabled.
    /// </summary>
    public class ApiClient : IScanApi
    {
        private readonly string _baseUrl;
        private readonly int _timeoutMs;
        private readonly string _userAgent;

        static ApiClient()
        {
            // Must run before the first HTTPS request. No-op on Windows CE.
            DeviceServices.EnsureModernTls();
        }

        public ApiClient(string baseUrl, int timeoutSeconds, string userAgent)
        {
            _baseUrl = (baseUrl ?? "").Trim().TrimEnd('/');
            _timeoutMs = Math.Max(2, timeoutSeconds) * 1000;
            _userAgent = userAgent;
        }

        public void Ping()
        {
            Request("GET", "/api/health", null, null);
        }

        public LoginResult Login(string username, string password, string deviceId)
        {
            JsonObjectBuilder body = new JsonObjectBuilder()
                .Add("username", username).Add("password", password).Add("deviceId", deviceId);
            Dictionary<string, object> o = ParseObject(Request("POST", "/api/auth/login", body.ToString(), null));
            LoginResult r = new LoginResult();
            r.Token = Json.GetString(o, "accessToken");
            r.UserId = Json.GetString(o, "userId");
            r.FullName = Json.GetString(o, "fullName");
            r.Role = Json.GetString(o, "role");
            r.ExpiresUtc = Util.ParseLocal(Json.GetString(o, "expiresAt"));
            if (string.IsNullOrEmpty(r.Token) || string.IsNullOrEmpty(r.UserId))
                throw new ApiException(ApiErrorKind.BadResponse, 200, null, "login response incomplete");
            return r;
        }

        public List<SessionInfo> GetOpenSessions(string token)
        {
            string text = Request("GET", "/api/sessions", null, token);
            List<object> list;
            try
            {
                list = Json.Parse(text) as List<object>;
            }
            catch (FormatException ex)
            {
                throw new ApiException(ApiErrorKind.BadResponse, 200, null, ex.Message);
            }
            if (list == null) throw new ApiException(ApiErrorKind.BadResponse, 200, null, "session list expected");
            List<SessionInfo> sessions = new List<SessionInfo>();
            foreach (object item in list)
            {
                Dictionary<string, object> o = item as Dictionary<string, object>;
                if (o == null) continue;
                SessionInfo s = new SessionInfo();
                s.Id = Json.GetString(o, "id");
                s.Name = Json.GetString(o, "name");
                s.SessionType = Json.GetString(o, "sessionType");
                if (!string.IsNullOrEmpty(s.Id) && !string.IsNullOrEmpty(s.Name)) sessions.Add(s);
            }
            return sessions;
        }

        public static string BuildScanJson(ScanRecord r)
        {
            JsonObjectBuilder b = new JsonObjectBuilder()
                .Add("clientScanId", r.ClientScanId)
                .Add("deviceId", r.DeviceId)
                .Add("operatorId", string.IsNullOrEmpty(r.OperatorId) ? null : r.OperatorId)
                .Add("sessionId", string.IsNullOrEmpty(r.SessionId) ? null : r.SessionId)
                .Add("barcode", r.Barcode)
                .Add("rawBarcode", r.RawBarcode)
                .Add("source", "WINDOWS_CE")
                .Add("scannedAtDevice", r.ScannedAtDevice);
            return b.ToString();
        }

        public ScanApiResult SendScan(ScanRecord record, string token)
        {
            Dictionary<string, object> o = ParseObject(Request("POST", "/api/scans", BuildScanJson(record), token));
            ScanApiResult r = new ScanApiResult();
            r.Accepted = Json.GetBool(o, "accepted", false);
            r.Result = Json.GetString(o, "result");
            r.ServerScanId = Json.GetString(o, "serverScanId");
            r.ItemName = Json.GetString(o, "itemName");
            r.ProductCode = Json.GetString(o, "productCode");
            r.CurrentStock = Json.GetInt(o, "currentStock", -1);
            r.Replayed = Json.GetBool(o, "replayed", false);
            r.Error = Json.GetString(o, "error");
            r.Message = Json.GetString(o, "message");
            if (r.Result == null || (r.Accepted && r.ServerScanId == null))
                throw new ApiException(ApiErrorKind.BadResponse, 200, null, "scan response incomplete");
            return r;
        }

        public void SendHeartbeat(HeartbeatInfo info, string token)
        {
            JsonObjectBuilder b = new JsonObjectBuilder()
                .Add("deviceId", info.DeviceId)
                .Add("appVersion", info.AppVersion)
                .Add("operatorId", string.IsNullOrEmpty(info.OperatorId) ? null : info.OperatorId)
                .AddNullableInt("batteryLevel", info.BatteryLevel, info.BatteryLevel >= 0 && info.BatteryLevel <= 100)
                .Add("pendingScans", info.PendingScans)
                .Add("timestamp", Util.FormatLocal(info.Timestamp));
            Request("POST", "/api/device/heartbeat", b.ToString(), token);
        }

        public DeviceConfigInfo GetDeviceConfig(string deviceId, string token)
        {
            Dictionary<string, object> o = ParseObject(
                Request("GET", "/api/device/config?deviceId=" + UrlEncode(deviceId), null, token));
            DeviceConfigInfo c = new DeviceConfigInfo();
            c.DeviceName = Json.GetString(o, "deviceName");
            c.Status = Json.GetString(o, "status");
            c.SyncIntervalSeconds = Json.GetInt(o, "syncIntervalSeconds", 0);
            c.DuplicateWindowSeconds = Json.GetInt(o, "duplicateWindowSeconds", -1);
            return c;
        }

        private static string UrlEncode(string value)
        {
            StringBuilder sb = new StringBuilder();
            foreach (byte b in Encoding.UTF8.GetBytes(value))
            {
                char c = (char)b;
                if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.')
                    sb.Append(c);
                else
                    sb.Append('%').Append(b.ToString("X2"));
            }
            return sb.ToString();
        }

        private static Dictionary<string, object> ParseObject(string text)
        {
            try
            {
                return Json.ParseObject(text);
            }
            catch (Exception ex)
            {
                throw new ApiException(ApiErrorKind.BadResponse, 200, null, "invalid JSON: " + ex.Message);
            }
        }

        /// <summary>Performs one HTTP request and returns the body of a 2xx response.</summary>
        public string Request(string method, string path, string jsonBody, string token)
        {
            HttpWebRequest req;
            try
            {
                req = (HttpWebRequest)WebRequest.Create(_baseUrl + path);
            }
            catch (Exception ex)
            {
                throw new ApiException(ApiErrorKind.Network, 0, "BAD_URL", "URL invalida: " + ex.Message);
            }
            req.Method = method;
            req.Timeout = _timeoutMs;
            req.ReadWriteTimeout = _timeoutMs;
            // Fresh connection per call: stale keep-alive sockets after Wi-Fi roaming are a classic CE hang.
            req.KeepAlive = false;
            req.Accept = "application/json";
            req.UserAgent = _userAgent;
            if (token != null) req.Headers["Authorization"] = "Bearer " + token;

            HttpWebResponse resp = null;
            try
            {
                if (jsonBody != null)
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(jsonBody);
                    req.ContentType = "application/json; charset=utf-8";
                    req.ContentLength = bytes.Length;
                    using (Stream s = req.GetRequestStream())
                    {
                        s.Write(bytes, 0, bytes.Length);
                    }
                }
                resp = (HttpWebResponse)req.GetResponse();
            }
            catch (WebException ex)
            {
                resp = ex.Response as HttpWebResponse;
                if (resp == null)
                {
                    // Keep WebExceptionStatus (e.g. SecureChannelFailure, TrustFailure, NameResolutionFailure) for diagnosis.
                    Logger.Warn("http " + method + " " + path + " failed: status=" + ex.Status + " msg=" + ex.Message
                                + (ex.InnerException != null ? " inner=" + ex.InnerException.Message : ""));
                    throw new ApiException(ApiErrorKind.Network, 0, ex.Status.ToString(), "rede: " + ex.Status);
                }
            }
            catch (IOException ex)
            {
                throw new ApiException(ApiErrorKind.Network, 0, "IO", "rede: " + ex.Message);
            }
            catch (System.Net.Sockets.SocketException ex)
            {
                throw new ApiException(ApiErrorKind.Network, 0, "SOCKET", "rede: " + ex.Message);
            }

            int status;
            string body;
            try
            {
                status = (int)resp.StatusCode;
                using (Stream rs = resp.GetResponseStream())
                using (StreamReader reader = new StreamReader(rs, Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }
            }
            catch (Exception ex)
            {
                // Connection dropped while reading: the server may have processed the request.
                throw new ApiException(ApiErrorKind.Network, 0, "READ", "resposta perdida: " + ex.Message);
            }
            finally
            {
                resp.Close();
            }

            if (status >= 200 && status < 300) return body;
            throw ErrorFromResponse(status, body);
        }

        private static ApiException ErrorFromResponse(int status, string body)
        {
            string code = null;
            string message = "HTTP " + status;
            bool fromApi = false;
            try
            {
                Dictionary<string, object> o = Json.ParseObject(body);
                code = Json.GetString(o, "error");
                string m = Json.GetString(o, "message");
                if (m != null) message = m;
                fromApi = code != null || o.ContainsKey("detail");
            }
            catch (Exception)
            {
                // non-JSON error page (proxy, captive portal, wrong server...)
            }
            ApiErrorKind kind;
            if (status == 401 && fromApi) kind = ApiErrorKind.Unauthorized;
            else if (status == 403 && fromApi) kind = ApiErrorKind.Forbidden;
            // Permanent rejection only when our API said so; a proxy error page must never
            // cause a scan to stop being retried.
            else if (fromApi && (status == 400 || status == 409 || status == 413 || status == 422)) kind = ApiErrorKind.Rejected;
            else kind = ApiErrorKind.Server;
            return new ApiException(kind, status, code, message);
        }
    }
}
