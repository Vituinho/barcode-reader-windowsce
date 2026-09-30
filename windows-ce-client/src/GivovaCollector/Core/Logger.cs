using System;
using System.IO;
using System.Text;

namespace GivovaCollector.Core
{
    /// <summary>
    /// Small rotating diagnostic log. Never pass passwords or tokens to it.
    /// File is opened per line so a crash never loses buffered log text.
    /// </summary>
    public static class Logger
    {
        private static readonly object Sync = new object();
        private static string _path;
        private static int _maxBytes = 256 * 1024;

        public static void Init(string directory, int maxBytes)
        {
            try
            {
                if (!Directory.Exists(directory)) Directory.CreateDirectory(directory);
                _path = Path.Combine(directory, "collector.log");
                if (maxBytes > 16 * 1024) _maxBytes = maxBytes;
            }
            catch (Exception)
            {
                _path = null; // logging must never break the application
            }
        }

        public static void Info(string message) { Write("INFO", message, null); }
        public static void Warn(string message) { Write("WARN", message, null); }
        public static void Error(string message, Exception ex) { Write("ERROR", message, ex); }

        private static void Write(string level, string message, Exception ex)
        {
            if (_path == null) return;
            lock (Sync)
            {
                try
                {
                    RotateIfNeeded();
                    StringBuilder sb = new StringBuilder(128);
                    sb.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
                    sb.Append(' ').Append(level).Append(' ').Append(message);
                    if (ex != null) sb.Append(" | ").Append(ex.GetType().Name).Append(": ").Append(ex.Message);
                    sb.Append("\r\n");
                    byte[] bytes = Encoding.UTF8.GetBytes(sb.ToString());
                    using (FileStream fs = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.Read))
                    {
                        fs.Write(bytes, 0, bytes.Length);
                    }
                }
                catch (Exception)
                {
                    // ignore: diagnostics are best effort
                }
            }
        }

        private static void RotateIfNeeded()
        {
            if (!File.Exists(_path)) return;
            FileInfo info = new FileInfo(_path);
            if (info.Length < _maxBytes) return;
            string old = Path.Combine(Path.GetDirectoryName(_path), "collector.1.log");
            if (File.Exists(old)) File.Delete(old);
            File.Move(_path, old);
        }
    }
}
