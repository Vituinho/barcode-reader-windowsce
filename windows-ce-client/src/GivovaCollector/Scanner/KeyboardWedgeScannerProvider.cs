using System;
using System.Windows.Forms;

namespace GivovaCollector.Scanner
{
    /// <summary>
    /// Scanner configured as a keyboard ("keyboard wedge"): the barcode arrives as typed characters
    /// followed by a terminator (ENTER by default, optionally TAB). Works with any brand, and in the
    /// desktop simulator by typing a code and pressing ENTER.
    ///
    /// The input box is multiline with AcceptsReturn/AcceptsTab so ENTER/TAB arrive as characters
    /// instead of moving focus or triggering a default button. Wedges that paste the whole value at once
    /// (WM_SETTEXT/clipboard style) are handled by scanning TextChanged for terminators.
    /// </summary>
    public class KeyboardWedgeScannerProvider : IScannerProvider
    {
        private readonly TextBox _input;
        private readonly bool _tabCompletes;
        private bool _started;
        private bool _suppressTextChanged;

        public event EventHandler<BarcodeScannedEventArgs> BarcodeScanned;

        public KeyboardWedgeScannerProvider(TextBox input, bool tabCompletes)
        {
            _input = input;
            _tabCompletes = tabCompletes;
            _input.Multiline = true;
            _input.AcceptsReturn = true;
            _input.AcceptsTab = true;
            _input.WordWrap = false;
            _input.MaxLength = 1024;
        }

        public string Name { get { return "Keyboard wedge"; } }

        public void Start()
        {
            if (_started) return;
            _started = true;
            _input.KeyPress += OnKeyPress;
            _input.TextChanged += OnTextChanged;
            EnsureFocus();
        }

        public void Stop()
        {
            if (!_started) return;
            _started = false;
            _input.KeyPress -= OnKeyPress;
            _input.TextChanged -= OnTextChanged;
        }

        /// <summary>Keeps the input box ready for the next scan.</summary>
        public void EnsureFocus()
        {
            if (_input.Enabled && _input.Visible && !_input.Focused) _input.Focus();
        }

        private bool IsTerminator(char c)
        {
            return c == '\r' || c == '\n' || (c == '\t' && _tabCompletes);
        }

        private void OnKeyPress(object sender, KeyPressEventArgs e)
        {
            char c = e.KeyChar;
            if (c == '\t' && !_tabCompletes)
            {
                e.Handled = true; // never let TAB become part of a barcode
                return;
            }
            if (!IsTerminator(c)) return;
            e.Handled = true;
            string text = _input.Text;
            Clear();
            // Empty text: second half of CR+LF, or a stray ENTER -> ignored.
            if (text.Length > 0) Raise(text + c);
        }

        private void OnTextChanged(object sender, EventArgs e)
        {
            if (_suppressTextChanged) return;
            string text = _input.Text;
            int last = -1;
            for (int i = 0; i < text.Length; i++) if (IsTerminator(text[i])) last = i;
            if (last < 0) return;

            string remainder = text.Substring(last + 1);
            _suppressTextChanged = true;
            try
            {
                _input.Text = remainder;
                _input.SelectionStart = remainder.Length;
            }
            finally
            {
                _suppressTextChanged = false;
            }

            int start = 0;
            for (int i = 0; i <= last; i++)
            {
                if (!IsTerminator(text[i])) continue;
                if (i > start) Raise(text.Substring(start, i - start + 1));
                start = i + 1;
            }
        }

        private void Clear()
        {
            _suppressTextChanged = true;
            try { _input.Text = ""; }
            finally { _suppressTextChanged = false; }
        }

        private void Raise(string raw)
        {
            EventHandler<BarcodeScannedEventArgs> handler = BarcodeScanned;
            if (handler != null) handler(this, new BarcodeScannedEventArgs(raw, null));
        }
    }
}
