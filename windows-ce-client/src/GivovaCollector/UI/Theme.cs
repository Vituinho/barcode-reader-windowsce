using System;
using System.Drawing;
using System.Windows.Forms;
using GivovaCollector.Platform;

namespace GivovaCollector.UI
{
    /// <summary>
    /// Fonts, colors and layout helpers sized for 240x320, 320x240 and 480x640 screens,
    /// large enough for gloved hands. Everything is laid out in code (no designer files) so
    /// the forms adapt to the screen instead of assuming one resolution.
    /// </summary>
    public static class Theme
    {
        public static readonly Color Background = Color.White;
        public static readonly Color Text = Color.Black;
        public static readonly Color Muted = Color.FromArgb(90, 90, 90);
        public static readonly Color HeaderBack = Color.FromArgb(20, 45, 95);
        public static readonly Color Success = Color.FromArgb(0, 135, 0);
        public static readonly Color Unknown = Color.FromArgb(215, 105, 0);
        public static readonly Color Offline = Color.FromArgb(0, 80, 185);
        public static readonly Color Duplicate = Color.FromArgb(160, 120, 0);
        public static readonly Color Error = Color.FromArgb(200, 0, 0);
        public static readonly Color Conflict = Color.FromArgb(120, 0, 120);
        public static readonly Color Neutral = Color.FromArgb(70, 70, 70);
        public static readonly Color ButtonBack = Color.FromArgb(225, 230, 240);

        public static Font Small;
        public static Font SmallBold;
        public static Font Medium;
        public static Font Large;
        public static Font Status;

        /// <summary>Client size used by the desktop simulator (not used on Windows CE).</summary>
        public static Size SimulatorSize = new Size(240, 320);

        private static bool _configured;

        /// <summary>Scales point sizes from the 240px-wide QVGA baseline, independent of DPI.</summary>
        public static void Configure(int screenWidth, int screenHeight, float dpi)
        {
            float shortSide = Math.Min(screenWidth, screenHeight);
            float scale = (shortSide / 240f) * (96f / (dpi <= 0 ? 96f : dpi));
            if (scale < 0.8f) scale = 0.8f;
            if (scale > 1.6f) scale = 1.6f;
            Small = new Font("Tahoma", 8f * scale, FontStyle.Regular);
            SmallBold = new Font("Tahoma", 8f * scale, FontStyle.Bold);
            Medium = new Font("Tahoma", 10f * scale, FontStyle.Bold);
            Large = new Font("Tahoma", 12f * scale, FontStyle.Bold);
            Status = new Font("Tahoma", 15f * scale, FontStyle.Bold);
            _configured = true;
        }

        public static void EnsureConfigured()
        {
            if (!_configured) Configure(240, 320, 96f);
        }

        public static void ApplyFormDefaults(Form form, string title)
        {
            EnsureConfigured();
            form.Text = title;
            form.BackColor = Background;
            form.MinimizeBox = false;
            form.MaximizeBox = false;
            if (DeviceServices.IsWindowsCE)
            {
                // Full screen: operators never need the CE shell while collecting.
                form.FormBorderStyle = FormBorderStyle.None;
                form.WindowState = FormWindowState.Maximized;
            }
            else
            {
                form.FormBorderStyle = FormBorderStyle.FixedSingle;
                form.ClientSize = SimulatorSize;
            }
        }

        public static Button MakeButton(string text)
        {
            Button b = new Button();
            b.Text = text;
            b.Font = Medium;
            b.BackColor = ButtonBack;
            b.ForeColor = Text;
            return b;
        }

        public static Label MakeLabel(string text, Font font, ContentAlignment align)
        {
            Label l = new Label();
            l.Text = text;
            l.Font = font;
            l.TextAlign = align;
            l.ForeColor = Text;
            l.BackColor = Background;
            return l;
        }

        public static Label MakeHeader(string text)
        {
            Label l = MakeLabel(text, Medium, ContentAlignment.TopCenter);
            l.BackColor = HeaderBack;
            l.ForeColor = Color.White;
            return l;
        }

        public static TextBox MakeTextBox(bool password)
        {
            TextBox t = new TextBox();
            t.Font = Medium;
            if (password) t.PasswordChar = '*';
            return t;
        }

        /// <summary>Base row height in pixels for the given client height.</summary>
        public static int Unit(int clientHeight)
        {
            return Math.Max(14, clientHeight / 16);
        }
    }

    /// <summary>Top-to-bottom row layout.</summary>
    public class RowLayout
    {
        private readonly int _left;
        private readonly int _width;
        private readonly int _gap;
        private int _y;

        public RowLayout(int top, int clientWidth, int margin, int gap)
        {
            _y = top;
            _left = margin;
            _width = clientWidth - 2 * margin;
            _gap = gap;
        }

        public int Y { get { return _y; } }

        public void Place(Control c, int height)
        {
            c.Bounds = new Rectangle(_left, _y, _width, height);
            _y += height + _gap;
        }

        /// <summary>Places controls side by side with equal widths.</summary>
        public void PlaceRow(Control[] controls, int height)
        {
            int n = controls.Length;
            int each = (_width - _gap * (n - 1)) / n;
            for (int i = 0; i < n; i++)
                controls[i].Bounds = new Rectangle(_left + i * (each + _gap), _y, each, height);
            _y += height + _gap;
        }

        public void Skip(int pixels)
        {
            _y += pixels;
        }
    }

    public delegate void UiAction();
    public delegate object WorkFunction();
    public delegate void WorkCompleted(object result, Exception error);

    /// <summary>Runs blocking work (HTTP) on a background thread and returns to the UI thread.</summary>
    public static class Background
    {
        public static void Run(Control owner, WorkFunction work, WorkCompleted done)
        {
            Thread(owner, work, done).Start();
        }

        private static System.Threading.Thread Thread(Control owner, WorkFunction work, WorkCompleted done)
        {
            System.Threading.Thread t = new System.Threading.Thread(delegate()
            {
                object result = null;
                Exception error = null;
                try { result = work(); }
                catch (Exception ex) { error = ex; }
                Ui.Post(owner, delegate { done(result, error); });
            });
            t.IsBackground = true;
            return t;
        }
    }

    public static class Ui
    {
        /// <summary>Executes on the control's UI thread; silently ignored if the form is already closed.</summary>
        public static void Post(Control owner, UiAction action)
        {
            try
            {
                if (owner.IsDisposed) return;
                if (owner.InvokeRequired) owner.BeginInvoke(action);
                else action();
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }
    }
}
