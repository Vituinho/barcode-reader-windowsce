using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using GivovaCollector.Core;
using GivovaCollector.Net;

namespace GivovaCollector.UI
{
    /// <summary>
    /// Selects the collection session. Downloads OPEN sessions; when offline, offers the last
    /// downloaded list so the operator is never blocked.
    /// </summary>
    public class SessionForm : Form
    {
        private readonly CollectorApp _app;
        private readonly Label _lblHeader;
        private readonly ListBox _list;
        private readonly Label _lblMessage;
        private readonly Button _btnSelect;
        private readonly Button _btnRefresh;
        private readonly Button _btnBack;
        private List<SessionInfo> _sessions = new List<SessionInfo>();
        private bool _busy;

        public SessionForm(CollectorApp app)
        {
            _app = app;
            Theme.ApplyFormDefaults(this, "Sessão");

            _lblHeader = Theme.MakeHeader("SELECIONAR SESSÃO");
            _list = new ListBox();
            _list.Font = Theme.Large;
            _lblMessage = Theme.MakeLabel("", Theme.SmallBold, ContentAlignment.TopCenter);
            _btnSelect = Theme.MakeButton("SELECIONAR");
            _btnRefresh = Theme.MakeButton("ATUALIZAR");
            _btnBack = Theme.MakeButton("VOLTAR");

            Controls.Add(_lblHeader);
            Controls.Add(_list);
            Controls.Add(_lblMessage);
            Controls.Add(_btnSelect);
            Controls.Add(_btnRefresh);
            Controls.Add(_btnBack);

            _btnSelect.Click += delegate { SelectSession(); };
            _btnRefresh.Click += delegate { LoadSessions(); };
            _btnBack.Click += delegate { DialogResult = DialogResult.Cancel; };
            _list.KeyPress += delegate(object s, KeyPressEventArgs e)
            {
                if (e.KeyChar == '\r') { e.Handled = true; SelectSession(); }
            };
            Resize += delegate { LayoutControls(); };
            Load += delegate { LoadSessions(); };
            LayoutControls();
        }

        private void LoadSessions()
        {
            if (_busy) return;
            string token = _app.State.UsableToken;
            if (token == null)
            {
                ShowList(_app.LoadSessionCache(), "OFFLINE - LISTA SALVA", Theme.Offline);
                return;
            }
            _busy = true;
            _btnRefresh.Enabled = false;
            _lblMessage.Text = "CARREGANDO...";
            _lblMessage.ForeColor = Theme.Neutral;
            IScanApi api = _app.CreateApi();
            Background.Run(this, delegate { return api.GetOpenSessions(token); },
                delegate(object value, Exception error)
                {
                    _busy = false;
                    _btnRefresh.Enabled = true;
                    if (error == null)
                    {
                        List<SessionInfo> sessions = (List<SessionInfo>)value;
                        _app.SaveSessionCache(sessions);
                        ShowList(sessions, sessions.Count == 0 ? "NENHUMA SESSÃO ABERTA" : "", Theme.Error);
                        return;
                    }
                    Logger.Warn("session list failed: " + error.Message);
                    ShowList(_app.LoadSessionCache(), "OFFLINE - LISTA SALVA", Theme.Offline);
                });
        }

        private void ShowList(List<SessionInfo> sessions, string message, Color color)
        {
            _sessions = sessions;
            _list.Items.Clear();
            int selected = -1;
            for (int i = 0; i < sessions.Count; i++)
            {
                _list.Items.Add(sessions[i].Name);
                if (sessions[i].Id == _app.State.SessionId) selected = i;
            }
            if (selected < 0 && sessions.Count > 0) selected = 0;
            _list.SelectedIndex = selected;
            _lblMessage.Text = message;
            _lblMessage.ForeColor = color;
            _list.Focus();
        }

        private void SelectSession()
        {
            int index = _list.SelectedIndex;
            if (index < 0 || index >= _sessions.Count)
            {
                _lblMessage.Text = "SELECIONE UMA SESSÃO";
                _lblMessage.ForeColor = Theme.Error;
                return;
            }
            SessionInfo s = _sessions[index];
            _app.State.SetSession(s.Id, s.Name);
            Logger.Info("session selected " + s.Id);
            DialogResult = DialogResult.OK;
        }

        private void LayoutControls()
        {
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            if (w <= 0 || h <= 0) return;
            int u = Theme.Unit(h);
            new RowLayout(0, w, 0, 0).Place(_lblHeader, u + u / 2);
            int buttonsH = u * 2;
            RowLayout rows = new RowLayout(u * 2, w, 6, 4);
            int listH = h - rows.Y - u * 2 - buttonsH * 2 - 16;
            rows.Place(_list, Math.Max(u * 3, listH));
            rows.Place(_lblMessage, u * 2);
            rows.Place(_btnSelect, buttonsH);
            rows.PlaceRow(new Control[] { _btnRefresh, _btnBack }, buttonsH);
        }
    }
}
