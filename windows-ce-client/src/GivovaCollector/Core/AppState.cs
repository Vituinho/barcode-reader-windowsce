using System;

namespace GivovaCollector.Core
{
    /// <summary>
    /// Runtime state that must survive an app restart or crash (state.ini in the data folder):
    /// logged operator, bearer token (never the password), selected session.
    /// Thread-safe: read by the sync thread, written by the UI thread.
    /// </summary>
    public class AppState
    {
        private readonly object _sync = new object();
        private readonly string _path;

        private string _token = "";
        private DateTime _tokenExpiresUtc = DateTime.MinValue;
        private bool _tokenRejected;
        private string _operatorId = "";
        private string _operatorName = "";
        private string _lastUsername = "";
        private string _sessionId = "";
        private string _sessionName = "";

        public AppState(string path)
        {
            _path = path;
        }

        public void Load()
        {
            IniFile ini = IniFile.Load(_path);
            lock (_sync)
            {
                _token = ini.Get("Token", "");
                _tokenExpiresUtc = Util.ParseLocal(ini.Get("TokenExpiresUtc", ""));
                _operatorId = ini.Get("OperatorId", "");
                _operatorName = ini.Get("OperatorName", "");
                _lastUsername = ini.Get("LastUsername", "");
                _sessionId = ini.Get("SessionId", "");
                _sessionName = ini.Get("SessionName", "");
            }
        }

        private void SaveLocked()
        {
            IniFile ini = new IniFile();
            ini.Set("Token", _token);
            ini.Set("TokenExpiresUtc", _tokenExpiresUtc == DateTime.MinValue ? "" : Util.FormatLocal(_tokenExpiresUtc));
            ini.Set("OperatorId", _operatorId);
            ini.Set("OperatorName", _operatorName);
            ini.Set("LastUsername", _lastUsername);
            ini.Set("SessionId", _sessionId);
            ini.Set("SessionName", _sessionName);
            try
            {
                ini.Save(_path, "Givova Coleta - estado (nao editar)");
            }
            catch (Exception ex)
            {
                Logger.Error("state save failed", ex);
            }
        }

        public void SetLogin(string username, string operatorId, string operatorName, string token, DateTime expiresUtc)
        {
            lock (_sync)
            {
                _lastUsername = username;
                _operatorId = operatorId;
                _operatorName = operatorName;
                _token = token;
                _tokenExpiresUtc = expiresUtc;
                _tokenRejected = false;
                SaveLocked();
            }
        }

        /// <summary>Operator logout. Pending scans stay in the queue with their original operator.</summary>
        public void Logout()
        {
            lock (_sync)
            {
                _token = "";
                _tokenExpiresUtc = DateTime.MinValue;
                _operatorId = "";
                _operatorName = "";
                SaveLocked();
            }
        }

        /// <summary>Server answered 401: keep operator/session (scanning continues) but require a new login to sync.</summary>
        public void MarkTokenRejected()
        {
            lock (_sync) _tokenRejected = true;
        }

        public void SetSession(string sessionId, string sessionName)
        {
            lock (_sync)
            {
                _sessionId = sessionId;
                _sessionName = sessionName;
                SaveLocked();
            }
        }

        public bool HasOperator { get { lock (_sync) return _operatorId.Length > 0; } }
        public bool HasSession { get { lock (_sync) return _sessionId.Length > 0; } }

        /// <summary>Token usable for API calls (server remains the authority: a 401 invalidates it).</summary>
        public string UsableToken
        {
            get
            {
                lock (_sync)
                {
                    if (_token.Length == 0 || _tokenRejected) return null;
                    if (_tokenExpiresUtc != DateTime.MinValue && DateTime.UtcNow > _tokenExpiresUtc) return null;
                    return _token;
                }
            }
        }

        public string OperatorId { get { lock (_sync) return _operatorId; } }
        public string OperatorName { get { lock (_sync) return _operatorName; } }
        public string LastUsername { get { lock (_sync) return _lastUsername; } }
        public string SessionId { get { lock (_sync) return _sessionId; } }
        public string SessionName { get { lock (_sync) return _sessionName; } }
    }
}
