using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Text;
using System.Windows.Forms;
using GivovaCollector.Core;
using GivovaCollector.Net;
using GivovaCollector.Platform;
using GivovaCollector.Scanner;

namespace GivovaCollector.UI
{
    /// <summary>
    /// Main collection screen. A normal scan needs no touch: trigger -> local durable save ->
    /// on-screen status -> background sync. Never shows modal dialogs while scanning.
    /// </summary>
    public class ScanForm : Form
    {
        private const int RecentCount = 5;

        private readonly CollectorApp _app;
        private readonly Label _lblHeader;
        private readonly Label _lblOperator;
        private readonly Label _lblSession;
        private readonly TextBox _txtBarcode;
        private readonly Label _lblStatus;
        private readonly Label _lblBarcode;
        private readonly Label _lblItem;
        private readonly Label _lblTime;
        private readonly Label _lblCounters;
        private readonly Label _lblNetwork;
        private readonly Label _lblRecent;
        private readonly Button _btnSync;
        private readonly Button _btnPending;
        private readonly Button _btnMenu;
        private readonly Panel _menu;
        private readonly Button[] _menuButtons;
        private readonly Timer _tick;
        private readonly Timer _startup;

        private IScannerProvider _scanner;
        private KeyboardWedgeScannerProvider _wedge;
        private bool _active;
        private string _lastClientScanId;
        private readonly List<ScanRecord> _recent = new List<ScanRecord>();
        private int _tickCount;

        public ScanForm(CollectorApp app)
        {
            _app = app;
            Theme.ApplyFormDefaults(this, AppInfo.Name);

            _lblHeader = Theme.MakeHeader(AppInfo.Name);
            _lblOperator = Theme.MakeLabel("", Theme.Small, ContentAlignment.TopLeft);
            _lblSession = Theme.MakeLabel("", Theme.SmallBold, ContentAlignment.TopLeft);
            _txtBarcode = Theme.MakeTextBox(false);
            _lblStatus = Theme.MakeLabel("PRONTO", Theme.Status, ContentAlignment.TopCenter);
            _lblBarcode = Theme.MakeLabel("", Theme.Medium, ContentAlignment.TopCenter);
            _lblItem = Theme.MakeLabel("", Theme.Small, ContentAlignment.TopCenter);
            _lblTime = Theme.MakeLabel("", Theme.Small, ContentAlignment.TopCenter);
            _lblCounters = Theme.MakeLabel("", Theme.SmallBold, ContentAlignment.TopLeft);
            _lblNetwork = Theme.MakeLabel("", Theme.SmallBold, ContentAlignment.TopLeft);
            _lblRecent = Theme.MakeLabel("", Theme.Small, ContentAlignment.TopLeft);
            _btnSync = Theme.MakeButton("SINC");
            _btnPending = Theme.MakeButton("PEND.");
            _btnMenu = Theme.MakeButton("MENU");
            SetStatus("PRONTO", Theme.Neutral);

            Controls.Add(_lblHeader);
            Controls.Add(_lblOperator);
            Controls.Add(_lblSession);
            Controls.Add(_txtBarcode);
            Controls.Add(_lblStatus);
            Controls.Add(_lblBarcode);
            Controls.Add(_lblItem);
            Controls.Add(_lblTime);
            Controls.Add(_lblCounters);
            Controls.Add(_lblNetwork);
            Controls.Add(_lblRecent);
            Controls.Add(_btnSync);
            Controls.Add(_btnPending);
            Controls.Add(_btnMenu);

            _menu = new Panel();
            _menu.BackColor = Theme.HeaderBack;
            _menu.Visible = false;
            string[] labels = new string[] { "TROCAR SESSÃO", "PENDÊNCIAS", "CONFIGURAÇÕES", "SOBRE", "SAIR (LOGOUT)", "FECHAR APLICATIVO", "VOLTAR" };
            _menuButtons = new Button[labels.Length];
            for (int i = 0; i < labels.Length; i++)
            {
                _menuButtons[i] = Theme.MakeButton(labels[i]);
                _menuButtons[i].Click += OnMenuClick;
                _menu.Controls.Add(_menuButtons[i]);
            }
            Controls.Add(_menu);
            _menu.BringToFront();

            _btnSync.Click += OnSyncClick;
            _btnPending.Click += delegate { ShowPending(); };
            _btnMenu.Click += delegate { ShowMenu(!_menu.Visible); };

            Resize += delegate { LayoutControls(); };
            Activated += delegate { _active = true; FocusInput(); };
            Deactivate += delegate { _active = false; };
            Closing += OnClosing;

            _app.Sync.StatusChanged += OnSyncStatusChanged;
            _app.Sync.ScanSynced += OnScanSynced;

            _tick = new Timer();
            _tick.Interval = 1000;
            _tick.Tick += OnTick;

            // Login/session dialogs start after the main window exists (safe on .NET CF).
            _startup = new Timer();
            _startup.Interval = 150;
            _startup.Tick += OnStartup;

            LayoutControls();
            _startup.Enabled = true;
        }

        // ---- startup / navigation -----------------------------------------------------------

        private void OnStartup(object sender, EventArgs e)
        {
            _startup.Enabled = false;
            if (!EnsureLoginAndSession(false))
            {
                Close();
                return;
            }
            _wedge = ScannerFactory.Create(_app.Config, _txtBarcode) as KeyboardWedgeScannerProvider;
            _scanner = _wedge;
            _scanner.BarcodeScanned += OnBarcodeScanned;
            _scanner.Start();
            Logger.Info("scanner started: " + _scanner.Name);
            _tick.Enabled = true;
            RefreshInfo();
            FocusInput();
        }

        /// <summary>Returns false when the operator chose to exit the application.</summary>
        private bool EnsureLoginAndSession(bool forceSessionChoice)
        {
            while (true)
            {
                bool justLoggedIn = false;
                if (!_app.State.HasOperator || _app.State.UsableToken == null)
                {
                    using (LoginForm login = new LoginForm(_app, false))
                    {
                        if (login.ShowDialog() != DialogResult.OK) return false;
                    }
                    justLoggedIn = true;
                }
                if (justLoggedIn || forceSessionChoice || !_app.State.HasSession)
                {
                    using (SessionForm sessions = new SessionForm(_app))
                    {
                        if (sessions.ShowDialog() != DialogResult.OK)
                        {
                            if (!justLoggedIn && !forceSessionChoice && _app.State.HasSession) return true;
                            _app.Logout();
                            continue;
                        }
                    }
                }
                RefreshInfo();
                return true;
            }
        }

        private void OnMenuClick(object sender, EventArgs e)
        {
            int index = Array.IndexOf(_menuButtons, sender);
            ShowMenu(false);
            switch (index)
            {
                case 0: // change session
                    using (SessionForm f = new SessionForm(_app)) f.ShowDialog();
                    break;
                case 1:
                    ShowPending();
                    break;
                case 2:
                    using (SettingsForm f = new SettingsForm(_app)) f.ShowDialog();
                    break;
                case 3:
                    using (AboutForm f = new AboutForm(_app)) f.ShowDialog();
                    break;
                case 4: // logout: pending scans stay in the device queue with their original operator
                    _app.Logout();
                    _recent.Clear();
                    SetStatus("PRONTO", Theme.Neutral);
                    if (!EnsureLoginAndSession(false)) { Close(); return; }
                    break;
                case 5:
                    Close();
                    return;
            }
            RefreshInfo();
            FocusInput();
        }

        private void ShowPending()
        {
            ShowMenu(false);
            using (PendingSyncForm f = new PendingSyncForm(_app)) f.ShowDialog();
            RefreshInfo();
            FocusInput();
        }

        private void OnSyncClick(object sender, EventArgs e)
        {
            if (_app.Sync.Connection == ConnectionState.LoginRequired)
            {
                // Re-login keeps the session and the queue; scanning never stopped.
                using (LoginForm login = new LoginForm(_app, true)) login.ShowDialog();
            }
            _app.Sync.Trigger(true);
            RefreshInfo();
            FocusInput();
        }

        private void ShowMenu(bool visible)
        {
            _menu.Visible = visible;
            if (visible) _menu.BringToFront();
            FocusInput();
        }

        // ---- scanning -----------------------------------------------------------------------

        private void OnBarcodeScanned(object sender, BarcodeScannedEventArgs e)
        {
            string raw = e.RawData;
            Ui.Post(this, delegate { HandleScan(raw); });
        }

        private void HandleScan(string raw)
        {
            if (_menu.Visible) ShowMenu(false);
            ScanOutcome outcome = _app.Processor.Process(raw);
            switch (outcome.Kind)
            {
                case ScanOutcomeKind.Ignored:
                    return;

                case ScanOutcomeKind.Saved:
                    _lastClientScanId = outcome.Record.ClientScanId;
                    AddRecent(outcome.Record);
                    if (_app.Sync.Connection == ConnectionState.Online || _app.Sync.Connection == ConnectionState.Unknown)
                    {
                        SetStatus("SALVO\nENVIANDO...", Theme.Neutral);
                        DeviceServices.PlayFeedback(FeedbackKind.Saved);
                    }
                    else
                    {
                        SetStatus("SALVO OFFLINE", Theme.Offline);
                        DeviceServices.PlayFeedback(FeedbackKind.SavedOffline);
                    }
                    _lblItem.Text = "";
                    _app.Sync.Trigger(false);
                    break;

                case ScanOutcomeKind.Duplicate:
                    SetStatus("DUPLICADO\nIGNORADO", Theme.Duplicate);
                    _lblItem.Text = "";
                    DeviceServices.PlayFeedback(FeedbackKind.Error);
                    break;

                default:
                    SetStatus("ERRO\n" + outcome.Message, Theme.Error);
                    _lblItem.Text = "";
                    DeviceServices.PlayFeedback(FeedbackKind.Error);
                    break;
            }
            _lblBarcode.Text = Util.Shorten(outcome.Barcode, 40);
            _lblTime.Text = DateTime.Now.ToString("HH:mm:ss");
            RefreshInfo();
            FocusInput();
        }

        private void OnScanSynced(object sender, ScanSyncedEventArgs e)
        {
            ScanRecord record = e.Record;
            Ui.Post(this, delegate { ApplySynced(record); });
        }

        private void ApplySynced(ScanRecord record)
        {
            for (int i = 0; i < _recent.Count; i++)
                if (_recent[i].ClientScanId == record.ClientScanId) _recent[i] = record;

            if (record.ClientScanId == _lastClientScanId)
            {
                string result = record.ServerResult;
                if (record.Status == ScanStatus.Rejected) SetStatus("ERRO\nREJEITADO", Theme.Error);
                else if (record.Status == ScanStatus.Conflict) SetStatus("SESSÃO FECHADA\nP/ REVISÃO", Theme.Conflict);
                else if (result == "KNOWN") SetStatus("REGISTRADO", Theme.Success);
                else if (result == "UNKNOWN") SetStatus("DESCONHECIDO\nREGISTRADO", Theme.Unknown);
                else if (result == "DUPLICATE") SetStatus("DUPLICADO\nIGNORADO", Theme.Duplicate);
                _lblItem.Text = record.ItemName ?? "";
            }
            RefreshInfo();
        }

        private void OnSyncStatusChanged(object sender, EventArgs e)
        {
            Ui.Post(this, delegate
            {
                ConnectionState state = _app.Sync.Connection;
                // The last scan was waiting for the server, which is now unreachable.
                if (state != ConnectionState.Online && _lastClientScanId != null && _lblStatus.Text.StartsWith("SALVO\n"))
                {
                    ScanRecord r = _app.Store.Get(_lastClientScanId);
                    if (r != null && r.IsPending) SetStatus("SALVO OFFLINE", Theme.Offline);
                }
                RefreshInfo();
            });
        }

        private void AddRecent(ScanRecord record)
        {
            _recent.Insert(0, record);
            while (_recent.Count > RecentCount) _recent.RemoveAt(_recent.Count - 1);
        }

        // ---- display ------------------------------------------------------------------------

        private void SetStatus(string text, Color color)
        {
            _lblStatus.Text = text;
            _lblStatus.BackColor = color;
            _lblStatus.ForeColor = Color.White;
        }

        private void OnTick(object sender, EventArgs e)
        {
            _tickCount++;
            if (_tickCount % 5 == 0) RefreshInfo();
            if (_active) FocusInput();
        }

        private void FocusInput()
        {
            if (_wedge != null) _wedge.EnsureFocus();
            else if (!_txtBarcode.Focused) _txtBarcode.Focus();
        }

        private void RefreshInfo()
        {
            _lblOperator.Text = "Operador: " + _app.State.OperatorName;
            _lblSession.Text = "Sessão: " + _app.State.SessionName;
            int pending = _app.Store.PendingCount;
            int rejected = _app.Store.CountByStatus(ScanStatus.Rejected);
            _lblCounters.Text = "Hoje: " + _app.Store.CountCreatedOn(DateTime.Today) + "   Pendentes: " + pending
                                + (rejected > 0 ? "   Rejeit.: " + rejected : "");

            ConnectionState state = _app.Sync.Connection;
            _lblNetwork.Text = "Rede: " + CollectorApp.DescribeConnection(state);
            _lblNetwork.ForeColor = state == ConnectionState.Online ? Theme.Success
                : (state == ConnectionState.Unknown ? Theme.Muted : Theme.Error);
            _btnSync.Text = state == ConnectionState.LoginRequired ? "LOGIN" : "SINC";

            StringBuilder sb = new StringBuilder();
            foreach (ScanRecord r in _recent)
            {
                sb.Append(r.ScannedAtDevice.Length >= 19 ? r.ScannedAtDevice.Substring(11, 8) : "");
                sb.Append(' ').Append(ShortStatus(r)).Append(' ').Append(Util.Shorten(r.Barcode, 22)).Append('\n');
            }
            _lblRecent.Text = sb.ToString();
        }

        private static string ShortStatus(ScanRecord r)
        {
            if (r.Status == ScanStatus.Pending) return "PEND";
            if (r.Status == ScanStatus.Rejected) return "ERRO";
            if (r.Status == ScanStatus.Conflict) return "CONF";
            if (r.ServerResult == "UNKNOWN") return "DESC";
            if (r.ServerResult == "DUPLICATE") return "DUPL";
            return "OK  ";
        }

        private void LayoutControls()
        {
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            if (w <= 0 || h <= 0) return;
            int u = Theme.Unit(h);
            bool landscape = w > h;
            RowLayout rows = new RowLayout(0, w, 0, 0);
            rows.Place(_lblHeader, u);

            RowLayout body = new RowLayout(rows.Y + 2, w, 4, 2);
            if (landscape)
            {
                _lblSession.Visible = true;
                body.PlaceRow(new Control[] { _lblOperator, _lblSession }, u);
            }
            else
            {
                body.Place(_lblOperator, u);
                body.Place(_lblSession, u);
            }
            body.Place(_txtBarcode, u + u / 2);

            int buttonsH = u * 2;
            int fixedBelow = (landscape ? 2 : 4) * (u + 2) + buttonsH + 4;
            bool showRecent = !landscape && h >= 400;
            int recentH = showRecent ? (int)(u * 0.8 * RecentCount) : 0;
            int statusH = Math.Max(u * 2, h - body.Y - fixedBelow - recentH);
            body.Place(_lblStatus, statusH);
            if (landscape)
            {
                body.PlaceRow(new Control[] { _lblBarcode, _lblItem }, u);
                body.PlaceRow(new Control[] { _lblCounters, _lblNetwork }, u);
                _lblTime.Visible = false;
            }
            else
            {
                body.Place(_lblBarcode, u);
                body.Place(_lblItem, u);
                body.PlaceRow(new Control[] { _lblTime, _lblNetwork }, u);
                _lblTime.Visible = true;
                body.Place(_lblCounters, u);
            }
            _lblRecent.Visible = showRecent;
            if (showRecent) body.Place(_lblRecent, recentH);

            RowLayout bottom = new RowLayout(h - buttonsH - 2, w, 2, 2);
            bottom.PlaceRow(new Control[] { _btnSync, _btnPending, _btnMenu }, buttonsH);

            _menu.Bounds = new Rectangle(0, 0, w, h);
            RowLayout menuRows = new RowLayout(4, w, 8, 4);
            int bh = Math.Max(u + u / 2, (h - 8) / _menuButtons.Length - 4);
            foreach (Button b in _menuButtons) menuRows.Place(b, bh);
        }

        private void OnClosing(object sender, CancelEventArgs e)
        {
            _tick.Enabled = false;
            if (_scanner != null) _scanner.Stop();
            _app.Sync.StatusChanged -= OnSyncStatusChanged;
            _app.Sync.ScanSynced -= OnScanSynced;
        }
    }
}
