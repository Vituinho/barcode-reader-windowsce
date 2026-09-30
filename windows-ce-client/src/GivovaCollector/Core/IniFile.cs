using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using GivovaCollector.Platform;

namespace GivovaCollector.Core
{
    /// <summary>
    /// key=value file (UTF-8). .NET CF has no app.config/ConfigurationManager support.
    /// Saves via tmp file + rename so a power loss never leaves a half-written file.
    /// </summary>
    public class IniFile
    {
        private readonly Dictionary<string, string> _values = new Dictionary<string, string>();
        private readonly List<string> _keys = new List<string>();

        public static IniFile Load(string path)
        {
            IniFile ini = new IniFile();
            string source = File.Exists(path) ? path : (File.Exists(path + ".tmp") ? path + ".tmp" : null);
            if (source == null) return ini;
            using (FileStream fs = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (StreamReader reader = new StreamReader(fs, Encoding.UTF8))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    string t = line.Trim();
                    if (t.Length == 0 || t[0] == '#' || t[0] == ';' || t[0] == '[') continue;
                    int eq = t.IndexOf('=');
                    if (eq <= 0) continue;
                    ini.Set(t.Substring(0, eq).Trim(), t.Substring(eq + 1).Trim());
                }
            }
            return ini;
        }

        public string Get(string key, string fallback)
        {
            string v;
            return _values.TryGetValue(key, out v) ? v : fallback;
        }

        public void Set(string key, string value)
        {
            if (!_values.ContainsKey(key)) _keys.Add(key);
            _values[key] = value == null ? "" : value.Replace("\r", "").Replace("\n", "");
        }

        public void Save(string path, string header)
        {
            StringBuilder sb = new StringBuilder();
            if (header != null) sb.Append("# ").Append(header).Append("\r\n");
            foreach (string key in _keys) sb.Append(key).Append('=').Append(_values[key]).Append("\r\n");
            byte[] bytes = Encoding.UTF8.GetBytes(sb.ToString());
            string tmp = path + ".tmp";
            using (FileStream fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush();
                DeviceServices.FlushToStorage(fs);
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }
    }
}
