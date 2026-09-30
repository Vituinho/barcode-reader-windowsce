using System;
using System.Drawing;
using System.Windows.Forms;
using GivovaCollector.Core;
using GivovaCollector.Net;

namespace GivovaCollector.UI
{
    /// <summary>
    /// Operator login. The password is sent once to the server and never stored; only the returned
    /// bearer token is kept. Offline login is intentionally not available (see README).
    /// </summary>
    public class LoginForm : Form
    {
        private readonly CollectorApp _app;
        private readonly bool _relogin;
        private readonly Label _lblHeader;
        private readonly Label _lblUser;
        private readonly Label _lblPassword;
        private readonly TextBox _txtUser;
        private readonly TextBox _txtPassword;
        private readonly Label _lblMessage;
        private readonly Button _btnLogin;
        private readonly Button _btnSettings;
        private readonly Button _btnExit;
        private readonly Label _lblFooter;
        private bool _busy;

        /// <param name="relogin">true when renewing an expired login from the scan screen.</param>
        public LoginForm(CollectorApp app, bool relogin)
        {
            _app = app;
            _relogin = relogin;
            Theme.ApplyFormDefaults(this, "Login");

            _lblHeader = Theme.MakeHeader(AppInfo.Name);
            _lblUser = Theme.MakeLabel("Usuário", Theme.SmallBold, ContentAlignment.TopLeft);
            _lblPassword = Theme.MakeLabel("Senha", Theme.SmallBold, ContentAlignment.TopLeft);
            _txtUser = Theme.MakeTextBox(false);
            _txtPassword = Theme.MakeTextBox(true);
            _lblMessage = Theme.MakeLabel("", Theme.SmallBold, ContentAlignment.TopCenter);
            _btnLogin = Theme.MakeButton("ENTRAR");
            _btnSettings = Theme.MakeButton("CONFIG");
            _btnExit = Theme.MakeButton(relogin ? "VOLTAR" : "SAIR");
            _lblFooter = Theme.MakeLabel("", Theme.Small, ContentAlignment.TopCenter);

            Controls.Add(_lblHeader);
            Controls.Add(_lblUser);
            Controls.Add(_txtUser);
            Controls.Add(_lblPassword);
            Controls.Add(_txtPassword);
            Controls.Add(_lblMessage);
            Controls.Add(_btnLogin);
            Controls.Add(_btnSettings);
            Controls.Add(_btnExit);
            Controls.Add(_lblFooter);

            _txtUser.Text = _app.State.LastUsername;
            _txtUser.KeyPress += delegate(object s, KeyPressEventArgs e)
            {
                if (e.KeyChar == '\r' || e.KeyChar == '\t') { e.Handled = true; _txtPassword.Focus(); }
            };
            _txtPassword.KeyPress += delegate(object s, KeyPressEventArgs e)
            {
                if (e.KeyChar == '\r') { e.Handled = true; DoLogin(); }
            };
            _btnLogin.Click += delegate { DoLogin(); };
            _btnSettings.Click += delegate
            {
                using (SettingsForm f = new SettingsForm(_app)) f.ShowDialog();
                UpdateFooter();
            };
            _btnExit.Click += delegate { DialogResult = DialogResult.Cancel; };
            Resize += delegate { LayoutControls(); };
            Load += delegate
            {
                if (_relogin) ShowMessage("LOGIN EXPIRADO. ENTRE NOVAMENTE.", Theme.Unknown);
                if (_txtUser.Text.Length > 0) _txtPassword.Focus(); else _txtUser.Focus();
            };
            UpdateFooter();
            LayoutControls();
        }

        private void UpdateFooter()
        {
            _lblFooter.Text = "App v" + AppInfo.Version + "   Dev " + (_app.Config.DeviceId.Length > 0 ? _app.Config.DeviceId : "?");
            if (!_app.Config.IsConfigured) ShowMessage("COLETOR NÃO CONFIGURADO. TOQUE EM CONFIG.", Theme.Error);
        }

        private void ShowMessage(string text, Color color)
        {
            _lblMessage.Text = text;
            _lblMessage.ForeColor = color;
        }

        private void DoLogin()
        {
            if (_busy) return;
            if (!_app.Config.IsConfigured)
            {
                ShowMessage("COLETOR NÃO CONFIGURADO. TOQUE EM CONFIG.", Theme.Error);
                return;
            }
            string user = _txtUser.Text.Trim();
            string password = _txtPassword.Text;
            if (user.Length == 0 || password.Length == 0)
            {
                ShowMessage("INFORME USUÁRIO E SENHA", Theme.Error);
                return;
            }
            SetBusy(true);
            ShowMessage("CONECTANDO...", Theme.Neutral);
            IScanApi api = _app.CreateApi();
            string deviceId = _app.Config.DeviceId;
            Background.Run(this, delegate
            {
                LoginResult result = api.Login(user, password, deviceId);
                DeviceConfigInfo config = null;
                try { config = api.GetDeviceConfig(deviceId, result.Token); }
                catch (ApiException ex) { Logger.Warn("device config unavailable: " + ex.Message); }
                return new object[] { result, config };
            },
            delegate(object value, Exception error)
            {
                SetBusy(false);
                _txtPassword.Text = "";
                if (error != null)
                {
                    ShowMessage(Describe(error), Theme.Error);
                    Logger.Warn("login failed: " + error.Message);
                    _txtPassword.Focus();
                    return;
                }
                object[] pair = (object[])value;
                LoginResult login = (LoginResult)pair[0];
                _app.ApplyServerConfig((DeviceConfigInfo)pair[1]);
                _app.State.SetLogin(user, login.UserId, login.FullName, login.Token, login.ExpiresUtc);
                Logger.Info("login success operator=" + login.UserId);
                _app.Sync.Trigger(true);
                DialogResult = DialogResult.OK;
            });
        }

        private static string Describe(Exception error)
        {
            ApiException api = error as ApiException;
            if (api == null) return "ERRO: " + error.Message;
            switch (api.Kind)
            {
                case ApiErrorKind.Network: return "SEM CONEXÃO COM O SERVIDOR";
                case ApiErrorKind.Unauthorized: return "USUÁRIO OU SENHA INVÁLIDOS";
                case ApiErrorKind.Forbidden:
                    if (api.ErrorCode == "DEVICE_DISABLED") return "COLETOR DESATIVADO";
                    if (api.ErrorCode == "DEVICE_NOT_REGISTERED") return "COLETOR NÃO CADASTRADO";
                    if (api.ErrorCode == "USER_DISABLED") return "USUÁRIO DESATIVADO";
                    return "ACESSO NEGADO";
                default: return "ERRO SERVIDOR: " + api.Message;
            }
        }

        private void SetBusy(bool busy)
        {
            _busy = busy;
            _btnLogin.Enabled = !busy;
            _btnSettings.Enabled = !busy;
            _btnExit.Enabled = !busy;
        }

        private void LayoutControls()
        {
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            if (w <= 0 || h <= 0) return;
            int u = Theme.Unit(h);
            new RowLayout(0, w, 0, 0).Place(_lblHeader, u + u / 2);
            RowLayout rows = new RowLayout(u * 2, w, 8, 2);
            rows.Place(_lblUser, u);
            rows.Place(_txtUser, u + u / 2);
            rows.Place(_lblPassword, u);
            rows.Place(_txtPassword, u + u / 2);
            rows.Skip(u / 2);
            rows.Place(_lblMessage, u * 2);
            rows.Place(_btnLogin, u * 2);
            rows.PlaceRow(new Control[] { _btnSettings, _btnExit }, u * 2);
            new RowLayout(h - u - 2, w, 4, 0).Place(_lblFooter, u);
        }
    }
}
