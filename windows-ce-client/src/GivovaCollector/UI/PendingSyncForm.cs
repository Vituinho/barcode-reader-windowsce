using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using GivovaCollector.Core;

namespace GivovaCollector.UI
{
    /// <summary>Queue status: pending, rejected and conflict records. Nothing here deletes data.</summary>
    public class PendingSyncForm : Form
    {
        private readonly CollectorApp _app;
        private readonly Label _lblHeader;
        private readonly Label _lblSummary;
        private readonly ListBox _list;
        private readonly Button _btnSync;
        private readonly Button _btnRequeue;
        private readonly Button _btnBack;
        private readonly Timer _refresh;

        public PendingSyncForm(CollectorApp app)
        {
            _app = app;
            Theme.ApplyFormDefaults(this, "Pendências");

            _lblHeader = Theme.MakeHeader("PENDÊNCIAS");
            _lblSummary = Theme.MakeLabel("", Theme.SmallBold, ContentAlignment.TopLeft);
            _list = new ListBox();
            _list.Font = Theme.Small;
            _btnSync = Theme.MakeButton("SINCRONIZAR");
            _btnRequeue = Theme.MakeButton("REENVIAR ERROS");
            _btnBack = Theme.MakeButton("VOLTAR");

            Controls.Add(_lblHeader);
            Controls.Add(_lblSummary);
            Controls.Add(_list);
            Controls.Add(_btnSync);
            Controls.Add(_btnRequeue);
            Controls.Add(_btnBack);

            _btnSync.Click += delegate { _app.Sync.Trigger(true); RefreshView(); };
            _btnRequeue.Click += delegate
            {
                int n = _app.Store.RequeueRejected();
                Logger.Info("requeued rejected scans: " + n);
                _app.Sync.Trigger(true);
                RefreshView();
            };
            _btnBack.Click += delegate { DialogResult = DialogResult.OK; };

            _refresh = new Timer();
            _refresh.Interval = 2000;
            _refresh.Tick += delegate { RefreshView(); };
            Load += delegate { RefreshView(); _refresh.Enabled = true; };
            Closing += delegate { _refresh.Enabled = false; };
            Resize += delegate { LayoutControls(); };
            LayoutControls();
        }

        private void RefreshView()
        {
            ILocalScanStore store = _app.Store;
            _lblSummary.Text = "Pendentes: " + store.PendingCount
                               + "   Erros: " + store.CountByStatus(ScanStatus.Rejected)
                               + "\nConflitos: " + store.CountByStatus(ScanStatus.Conflict)
                               + "   Rede: " + CollectorApp.DescribeConnection(_app.Sync.Connection)
                               + (_app.Sync.LastError.Length > 0 ? "\n" + Util.Shorten(_app.Sync.LastError, 60) : "");

            List<ScanRecord> problems = store.GetProblems(100);
            _list.Items.Clear();
            foreach (ScanRecord r in problems)
            {
                string time = r.ScannedAtDevice.Length >= 19 ? r.ScannedAtDevice.Substring(11, 8) : "";
                string tag = r.Status == ScanStatus.Pending ? "PEND" : (r.Status == ScanStatus.Rejected ? "ERRO" : "CONF");
                string line = tag + " " + time + " " + Util.Shorten(r.Barcode, 20);
                if (r.SyncAttempts > 0) line += " (" + r.SyncAttempts + "x)";
                if (r.Status != ScanStatus.Pending && r.LastError != null) line += " " + Util.Shorten(r.LastError, 30);
                _list.Items.Add(line);
            }
        }

        private void LayoutControls()
        {
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            if (w <= 0 || h <= 0) return;
            int u = Theme.Unit(h);
            new RowLayout(0, w, 0, 0).Place(_lblHeader, u + u / 2);
            int buttonsH = u * 2;
            RowLayout rows = new RowLayout(u * 2, w, 4, 4);
            rows.Place(_lblSummary, u * 3);
            int listH = h - rows.Y - buttonsH * 2 - 12;
            rows.Place(_list, Math.Max(u * 2, listH));
            rows.PlaceRow(new Control[] { _btnSync, _btnRequeue }, buttonsH);
            rows.Place(_btnBack, buttonsH);
        }
    }
}
