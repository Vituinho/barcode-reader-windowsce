using System;
using System.Drawing;
using System.Windows.Forms;
using GivovaCollector.Core;
using GivovaCollector.Net;

namespace GivovaCollector.UI
{
    /// <summary>Administrator settings (PIN protected): device identity, API address, timings.</summary>
    public class SettingsForm : Form
    {
        private readonly CollectorApp _app;
        private readonly Label _lblHeader;

        // PIN step
        private readonly Panel _pinPanel;
        private readonly TextBox _txtPin;
        private readonly Label _lblPinMessage;

        // Settings step
        private readonly Panel _settingsPanel;
        private readonly TextBox _txtDeviceId;
        private readonly TextBox _txtDeviceName;
        private readonly TextBox _txtApiUrl;
        private readonly TextBox _txtSyncInterval;
        private readonly TextBox _txtTimeout;
        private readonly TextBox _txtDuplicateWindow;
        private readonly TextBox _txtDataDir;
        private readonly TextBox _txtNewPin;
        private readonly CheckBox _chkTab;
        private readonly CheckBox _chkSound;
        private readonly CheckBox _chkVendor;
        private readonly Label _lblMessage;
        private readonly Button _btnTest;
        private readonly Button _btnSave;
        private readonly Button _btnBack;
        private readonly Control[] _fieldOrder;

        public SettingsForm(CollectorApp app)
        {
            _app = app;
            Theme.ApplyFormDefaults(this, "Configurações");
            _lblHeader = Theme.MakeHeader("CONFIGURAÇÕES");
            Controls.Add(_lblHeader);

            // ---- PIN panel ----
            _pinPanel = new Panel();
            _pinPanel.BackColor = Theme.Background;
            _txtPin = Theme.MakeTextBox(true);
            _lblPinMessage = Theme.MakeLabel("PIN DO ADMINISTRADOR", Theme.SmallBold, ContentAlignment.TopCenter);
            Button btnPinOk = Theme.MakeButton("ENTRAR");
            Button btnPinBack = Theme.MakeButton("VOLTAR");
            _pinPanel.Controls.Add(_lblPinMessage);
            _pinPanel.Controls.Add(_txtPin);
            _pinPanel.Controls.Add(btnPinOk);
            _pinPanel.Controls.Add(btnPinBack);
            btnPinOk.Click += delegate { CheckPin(); };
            btnPinBack.Click += delegate { DialogResult = DialogResult.Cancel; };
            _txtPin.KeyPress += delegate(object s, KeyPressEventArgs e)
            {
                if (e.KeyChar == '\r') { e.Handled = true; CheckPin(); }
            };
            Controls.Add(_pinPanel);

            // ---- settings panel ----
            _settingsPanel = new Panel();
            _settingsPanel.BackColor = Theme.Background;
            _settingsPanel.AutoScroll = true;
            _settingsPanel.Visible = false;
            _txtDeviceId = Theme.MakeTextBox(false);
            _txtDeviceName = Theme.MakeTextBox(false);
            _txtApiUrl = Theme.MakeTextBox(false);
            _txtSyncInterval = Theme.MakeTextBox(false);
            _txtTimeout = Theme.MakeTextBox(false);
            _txtDuplicateWindow = Theme.MakeTextBox(false);
            _txtDataDir = Theme.MakeTextBox(false);
            _txtNewPin = Theme.MakeTextBox(true);
            _chkTab = new CheckBox();
            _chkTab.Text = "TAB finaliza leitura";
            _chkTab.Font = Theme.SmallBold;
            _chkSound = new CheckBox();
            _chkSound.Text = "Som habilitado";
            _chkSound.Font = Theme.SmallBold;
            _chkVendor = new CheckBox();
            _chkVendor.Text = "Scanner SDK fabricante";
            _chkVendor.Font = Theme.SmallBold;
            _lblMessage = Theme.MakeLabel("", Theme.SmallBold, ContentAlignment.TopCenter);
            _btnTest = Theme.MakeButton("TESTAR CONEXÃO");
            _btnSave = Theme.MakeButton("SALVAR");
            _btnBack = Theme.MakeButton("VOLTAR");

            _fieldOrder = new Control[]
            {
                Caption("ID do coletor (ex: GVT-CE-001)"), _txtDeviceId,
                Caption("Nome do coletor"), _txtDeviceName,
                Caption("URL da API (ex: http://192.168.0.10:8000)"), _txtApiUrl,
                Caption("Intervalo de sincronização (s)"), _txtSyncInterval,
                Caption("Timeout de rede (s)"), _txtTimeout,
                Caption("Janela de duplicidade (s)"), _txtDuplicateWindow,
                Caption("Pasta de dados (vazio = padrão)"), _txtDataDir,
                Caption("Novo PIN (vazio = manter)"), _txtNewPin,
                _chkTab, _chkSound, _chkVendor, _lblMessage, _btnTest, _btnSave, _btnBack
            };
            foreach (Control c in _fieldOrder) _settingsPanel.Controls.Add(c);
            Controls.Add(_settingsPanel);

            _btnTest.Click += delegate { TestConnection(); };
            _btnSave.Click += delegate { Save(); };
            _btnBack.Click += delegate { DialogResult = DialogResult.Cancel; };
            Resize += delegate { LayoutControls(); };
            Load += delegate { _txtPin.Focus(); };
            LayoutControls();
        }

        private static Label Caption(string text)
        {
            return Theme.MakeLabel(text, Theme.Small, ContentAlignment.TopLeft);
        }

        private void CheckPin()
        {
            if (!_app.Config.CheckPin(_txtPin.Text))
            {
                _txtPin.Text = "";
                _lblPinMessage.Text = "PIN INCORRETO";
                _lblPinMessage.ForeColor = Theme.Error;
                Logger.Warn("settings: wrong admin PIN");
                return;
            }
            AppConfig c = _app.Config;
            _txtDeviceId.Text = c.DeviceId;
            _txtDeviceName.Text = c.DeviceName;
            _txtApiUrl.Text = c.ApiBaseUrl;
            _txtSyncInterval.Text = c.SyncIntervalSeconds.ToString();
            _txtTimeout.Text = c.RequestTimeoutSeconds.ToString();
            _txtDuplicateWindow.Text = c.DuplicateWindowSeconds.ToString();
            _txtDataDir.Text = c.DataDirectory;
            _chkTab.Checked = c.TabCompletesScan;
            _chkSound.Checked = c.SoundEnabled;
            _chkVendor.Checked = c.ScannerMode == "VENDOR";
            if (c.AdminPinHash.Length == 0) ShowMessage("PIN PADRÃO EM USO: DEFINA UM NOVO PIN", Theme.Unknown);
            _pinPanel.Visible = false;
            _settingsPanel.Visible = true;
            _txtDeviceId.Focus();
        }

        private void ShowMessage(string text, Color color)
        {
            _lblMessage.Text = text;
            _lblMessage.ForeColor = color;
        }

        private static bool IsValidDeviceId(string id)
        {
            if (id.Length == 0 || id.Length > 40) return false;
            foreach (char ch in id)
            {
                bool ok = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.';
                if (!ok) return false;
            }
            return true;
        }

        private static bool IsValidUrl(string url)
        {
            return url.StartsWith("http://") || url.StartsWith("https://");
        }

        private void TestConnection()
        {
            string url = _txtApiUrl.Text.Trim().TrimEnd('/');
            if (!IsValidUrl(url))
            {
                ShowMessage("URL DEVE COMEÇAR COM http:// OU https://", Theme.Error);
                return;
            }
            IScanApi api = _app.CreateApi(url, Util.ParseInt(_txtTimeout.Text, 10));
            _btnTest.Enabled = false;
            ShowMessage("TESTANDO...", Theme.Neutral);
            Background.Run(this, delegate { api.Ping(); return null; },
                delegate(object value, Exception error)
                {
                    _btnTest.Enabled = true;
                    if (error == null) ShowMessage("OK: SERVIDOR RESPONDEU", Theme.Success);
                    else ShowMessage("FALHA: " + Util.Shorten(error.Message, 60), Theme.Error);
                });
        }

        private void Save()
        {
            AppConfig c = _app.Config;
            string deviceId = _txtDeviceId.Text.Trim();
            string url = _txtApiUrl.Text.Trim().TrimEnd('/');
            if (!IsValidDeviceId(deviceId))
            {
                ShowMessage("ID INVÁLIDO (letras, números, - _ .)", Theme.Error);
                return;
            }
            // Pending scans carry the old device id; the server only accepts them from that device.
            if (deviceId != c.DeviceId && c.DeviceId.Length > 0 && _app.Store.PendingCount > 0)
            {
                ShowMessage("SINCRONIZE AS PENDÊNCIAS ANTES DE TROCAR O ID", Theme.Error);
                return;
            }
            if (!IsValidUrl(url))
            {
                ShowMessage("URL DEVE COMEÇAR COM http:// OU https://", Theme.Error);
                return;
            }
            string newPin = _txtNewPin.Text.Trim();
            if (newPin.Length > 0 && newPin.Length < 4)
            {
                ShowMessage("PIN DEVE TER 4+ DÍGITOS", Theme.Error);
                return;
            }
            bool dataDirChanged = _txtDataDir.Text.Trim() != c.DataDirectory;

            c.DeviceId = deviceId;
            c.DeviceName = _txtDeviceName.Text.Trim();
            c.ApiBaseUrl = url;
            c.SyncIntervalSeconds = Clamp(Util.ParseInt(_txtSyncInterval.Text, c.SyncIntervalSeconds), 1, 3600);
            c.RequestTimeoutSeconds = Clamp(Util.ParseInt(_txtTimeout.Text, c.RequestTimeoutSeconds), 2, 120);
            c.DuplicateWindowSeconds = Clamp(Util.ParseInt(_txtDuplicateWindow.Text, c.DuplicateWindowSeconds), 0, 3600);
            c.DataDirectory = _txtDataDir.Text.Trim();
            c.TabCompletesScan = _chkTab.Checked;
            c.SoundEnabled = _chkSound.Checked;
            c.ScannerMode = _chkVendor.Checked ? "VENDOR" : "WEDGE";
            if (newPin.Length > 0) c.SetPin(newPin);
            try
            {
                c.Save();
            }
            catch (Exception ex)
            {
                Logger.Error("settings save failed", ex);
                ShowMessage("ERRO AO SALVAR: " + ex.Message, Theme.Error);
                return;
            }
            Logger.Info("settings saved device=" + c.DeviceId + " api=" + c.ApiBaseUrl);
            _app.ApplyConfigChange();
            _txtNewPin.Text = "";
            ShowMessage(dataDirChanged ? "SALVO. REINICIE O APLICATIVO." : "CONFIGURAÇÃO SALVA", Theme.Success);
        }

        private static int Clamp(int v, int min, int max)
        {
            return v < min ? min : (v > max ? max : v);
        }

        private void LayoutControls()
        {
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            if (w <= 0 || h <= 0) return;
            int u = Theme.Unit(h);
            new RowLayout(0, w, 0, 0).Place(_lblHeader, u + u / 2);
            Rectangle area = new Rectangle(0, u * 2, w, h - u * 2);

            _pinPanel.Bounds = area;
            RowLayout pin = new RowLayout(u, w, 12, 6);
            pin.Place(_lblPinMessage, u * 2);
            pin.Place(_txtPin, u + u / 2);
            foreach (Control c in _pinPanel.Controls)
                if (c is Button) pin.Place(c, u * 2);

            _settingsPanel.Bounds = area;
            // Leave room for the vertical scrollbar.
            RowLayout rows = new RowLayout(2, w - 16, 4, 2);
            foreach (Control c in _fieldOrder)
            {
                int height = c is TextBox ? u + u / 2 : (c is Button ? u * 2 : (c == _lblMessage ? u * 2 : u));
                rows.Place(c, height);
            }
        }
    }
}
