using System;
using System.Drawing;
using System.Windows.Forms;
using GivovaCollector.Core;
using GivovaCollector.Platform;
using GivovaCollector.UI;

namespace GivovaCollector
{
    public static class Program
    {
#if DESKTOP
        [STAThread]
#else
        [MTAThread]
#endif
        public static void Main(string[] args)
        {
            CollectorApp app;
            try
            {
                app = CollectorApp.Start(DeviceServices.AppDirectory);
            }
            catch (Exception ex)
            {
                // Startup only (not during scanning): the queue could not be opened.
                MessageBox.Show("Falha ao iniciar: " + ex.Message, AppInfo.Name, MessageBoxButtons.OK,
                    MessageBoxIcon.Hand, MessageBoxDefaultButton.Button1);
                return;
            }

            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                Logger.Error("unhandled exception", e.ExceptionObject as Exception);
            };

            ConfigureScreen(args);
            app.Sync.Start();
            try
            {
                Application.Run(new ScanForm(app));
            }
            finally
            {
                app.Shutdown();
            }
        }

        private static void ConfigureScreen(string[] args)
        {
            Rectangle screen = Screen.PrimaryScreen.Bounds;
            int width = screen.Width;
            int height = screen.Height;
            if (!DeviceServices.IsWindowsCE)
            {
                // Desktop simulator: --size=240x320 | 320x240 | 480x640
                Size size = new Size(240, 320);
                foreach (string arg in args)
                {
                    if (!arg.StartsWith("--size=")) continue;
                    string[] parts = arg.Substring(7).Split('x');
                    if (parts.Length == 2)
                        size = new Size(Util.ParseInt(parts[0], 240), Util.ParseInt(parts[1], 320));
                }
                Theme.SimulatorSize = size;
                width = size.Width;
                height = size.Height;
            }
            float dpi = 96f;
            using (Form probe = new Form())
            using (Graphics g = probe.CreateGraphics())
            {
                dpi = g.DpiX;
            }
            if (!DeviceServices.IsWindowsCE) dpi = 96f; // simulator draws at nominal size
            Theme.Configure(width, height, dpi);
        }
    }
}
