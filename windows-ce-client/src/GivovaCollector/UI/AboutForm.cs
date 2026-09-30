using System;
using System.Drawing;
using System.Text;
using System.Windows.Forms;
using GivovaCollector.Core;
using GivovaCollector.Platform;

namespace GivovaCollector.UI
{
    public class AboutForm : Form
    {
        private readonly Label _lblHeader;
        private readonly Label _lblInfo;
        private readonly Button _btnBack;

        public AboutForm(CollectorApp app)
        {
            Theme.ApplyFormDefaults(this, "Sobre");
            _lblHeader = Theme.MakeHeader("SOBRE");
            _lblInfo = Theme.MakeLabel("", Theme.Small, ContentAlignment.TopLeft);
            _btnBack = Theme.MakeButton("VOLTAR");
            Controls.Add(_lblHeader);
            Controls.Add(_lblInfo);
            Controls.Add(_btnBack);

            int battery = DeviceServices.GetBatteryPercent();
            StringBuilder sb = new StringBuilder();
            sb.Append("App v").Append(AppInfo.Version).Append('\n');
            sb.Append("Device ").Append(app.Config.DeviceId).Append('\n');
            sb.Append("API: ").Append(app.Config.ApiBaseUrl).Append('\n');
            sb.Append("Dados: ").Append(app.DataDirectory).Append('\n');
            sb.Append("Registros locais: ").Append(app.Store.TotalRecords).Append('\n');
            sb.Append("Pendentes: ").Append(app.Store.PendingCount).Append('\n');
            sb.Append("Linhas corrompidas ignoradas: ").Append(app.Store.CorruptLinesSkipped).Append('\n');
            sb.Append("Rede: ").Append(CollectorApp.DescribeConnection(app.Sync.Connection)).Append('\n');
            sb.Append("Bateria: ").Append(battery >= 0 ? battery + "%" : "n/d").Append('\n');
            sb.Append("SO: ").Append(Environment.OSVersion.ToString()).Append('\n');
            sb.Append(".NET: ").Append(Environment.Version.ToString()).Append('\n');
            _lblInfo.Text = sb.ToString();

            _btnBack.Click += delegate { DialogResult = DialogResult.OK; };
            Resize += delegate { LayoutControls(); };
            LayoutControls();
        }

        private void LayoutControls()
        {
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            if (w <= 0 || h <= 0) return;
            int u = Theme.Unit(h);
            new RowLayout(0, w, 0, 0).Place(_lblHeader, u + u / 2);
            RowLayout rows = new RowLayout(u * 2, w, 6, 4);
            rows.Place(_lblInfo, h - u * 2 - u * 2 - 12);
            rows.Place(_btnBack, u * 2);
        }
    }
}
