using System;
using System.Globalization;

namespace GivovaCollector.Core
{
    /// <summary>
    /// Parsing helpers. TryParse overloads are not reliably available on .NET CF, so parse inside try/catch.
    /// </summary>
    public static class Util
    {
        public const string LocalTimeFormat = "yyyy-MM-ddTHH:mm:ss";

        public static int ParseInt(string value, int fallback)
        {
            if (value == null) return fallback;
            try { return int.Parse(value.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture); }
            catch (Exception) { return fallback; }
        }

        public static bool ParseBool(string value, bool fallback)
        {
            if (value == null) return fallback;
            string v = value.Trim().ToLower(CultureInfo.InvariantCulture);
            if (v == "1" || v == "true" || v == "yes" || v == "sim") return true;
            if (v == "0" || v == "false" || v == "no" || v == "nao") return false;
            return fallback;
        }

        public static string FormatLocal(DateTime value)
        {
            return value.ToString(LocalTimeFormat, CultureInfo.InvariantCulture);
        }

        /// <summary>Parses "yyyy-MM-ddTHH:mm:ss" (extra fraction/offset ignored). Returns MinValue on failure.</summary>
        public static DateTime ParseLocal(string value)
        {
            if (value == null || value.Length < 19) return DateTime.MinValue;
            try
            {
                return DateTime.ParseExact(value.Substring(0, 19), LocalTimeFormat, CultureInfo.InvariantCulture,
                    DateTimeStyles.None);
            }
            catch (Exception)
            {
                return DateTime.MinValue;
            }
        }

        /// <summary>Milliseconds elapsed between two Environment.TickCount values (wrap-around safe).</summary>
        public static int TicksElapsed(int from, int to)
        {
            return unchecked(to - from);
        }

        public static string Shorten(string value, int max)
        {
            if (value == null) return "";
            return value.Length <= max ? value : value.Substring(0, max - 1) + "~";
        }
    }
}
