using System;
using System.Collections.Generic;
using System.Text;

namespace GivovaCollector.Core
{
    /// <summary>
    /// Barcode values are opaque text (EAN, UPC, Code 39/128, GS1-128, ITF, QR text...).
    /// Only scanner framing characters are removed; case, leading zeroes, spaces inside the value,
    /// separators and GS1 group separators (0x1D) are preserved.
    /// </summary>
    public static class BarcodeCleaner
    {
        public static string Clean(string raw)
        {
            if (raw == null) return "";
            string s = raw.IndexOf('\0') >= 0 ? raw.Replace("\0", "") : raw;

            int start = 0;
            int end = s.Length;
            // Leading STX (0x02) sometimes used as a prefix by serial/keyboard wedges
            while (start < end && s[start] == '\x02') start++;
            // Trailing terminators: CR, LF, TAB, ETX, EOT
            while (end > start)
            {
                char c = s[end - 1];
                if (c == '\r' || c == '\n' || c == '\t' || c == '\x03' || c == '\x04') end--;
                else break;
            }
            string value = s.Substring(start, end - start);

            for (int i = 0; i < value.Length; i++)
            {
                if (!char.IsWhiteSpace(value[i])) return value;
            }
            return ""; // whitespace-only input is treated as empty
        }
    }

    /// <summary>
    /// Product identity rule (server-authoritative, mirrored here for immediate feedback): the product code is
    /// the FIRST 10 characters of the reading after trimming surrounding whitespace. Logistics labels may be
    /// much longer; the full reading is still stored and sent as rawBarcode. Never parsed as a number.
    /// </summary>
    public static class ProductCode
    {
        public const int Length = 10;

        /// <summary>First 10 characters, or null when the reading is shorter (invalid code).</summary>
        public static string Normalize(string barcode)
        {
            if (barcode == null) return null;
            string value = barcode.Trim();
            return value.Length < Length ? null : value.Substring(0, Length);
        }
    }

    public static class ScanIdGenerator
    {
        /// <summary>
        /// Globally unique id created on the device before any network call:
        /// {deviceId}-{yyyyMMddHHmmss}-{guid}. The server enforces uniqueness (idempotency key).
        /// </summary>
        public static string NewId(string deviceId, DateTime now)
        {
            return deviceId + "-" + now.ToString("yyyyMMddHHmmss") + "-" + Guid.NewGuid().ToString("N");
        }
    }

    /// <summary>
    /// Suppresses accidental double triggers: same device+operator+session+barcode within the window.
    /// Uses Environment.TickCount (monotonic) so clock changes do not affect it.
    /// </summary>
    public class DuplicateDetector
    {
        private readonly Dictionary<string, int> _lastSeen = new Dictionary<string, int>();
        private int _windowMs;

        public DuplicateDetector(int windowSeconds)
        {
            WindowSeconds = windowSeconds;
        }

        public int WindowSeconds
        {
            get { return _windowMs / 1000; }
            set { _windowMs = Math.Max(0, value) * 1000; }
        }

        public static string Key(string deviceId, string operatorId, string sessionId, string barcode)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append(deviceId).Append('\x1F').Append(operatorId).Append('\x1F').Append(sessionId).Append('\x1F').Append(barcode);
            return sb.ToString();
        }

        public bool IsDuplicate(string key, int nowTicks)
        {
            if (_windowMs <= 0) return false;
            int last;
            if (!_lastSeen.TryGetValue(key, out last)) return false;
            int elapsed = Util.TicksElapsed(last, nowTicks);
            return elapsed >= 0 && elapsed < _windowMs;
        }

        public void Register(string key, int nowTicks)
        {
            if (_lastSeen.Count > 64) _lastSeen.Clear(); // only very recent scans matter
            _lastSeen[key] = nowTicks;
        }
    }
}
