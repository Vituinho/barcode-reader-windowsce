using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace GivovaCollector.Core
{
    /// <summary>Device configuration (collector.ini next to the executable). Edited on SettingsForm.</summary>
    public class AppConfig
    {
        public const string DefaultPin = "1234";

        public string DeviceId = "";
        public string DeviceName = "";
        public string ApiBaseUrl = "http://192.168.0.10:8000";
        public int SyncIntervalSeconds = 5;
        public int RequestTimeoutSeconds = 10;
        public int DuplicateWindowSeconds = 2;
        public int HeartbeatIntervalSeconds = 60;
        public bool TabCompletesScan = true;
        public bool SoundEnabled = true;
        /// <summary>WEDGE (keyboard) or VENDOR (manufacturer SDK, see VendorScannerProvider).</summary>
        public string ScannerMode = "WEDGE";
        /// <summary>Folder for the scan journal. Must be on storage that survives a cold boot.</summary>
        public string DataDirectory = "";
        public string AdminPinHash = "";

        private string _path;

        public string Path { get { return _path; } }

        public bool IsConfigured
        {
            get { return DeviceId.Length > 0 && ApiBaseUrl.Length > 0; }
        }

        public static AppConfig Load(string path)
        {
            IniFile ini = IniFile.Load(path);
            AppConfig c = new AppConfig();
            c._path = path;
            c.DeviceId = ini.Get("DeviceId", c.DeviceId).Trim();
            c.DeviceName = ini.Get("DeviceName", c.DeviceName);
            c.ApiBaseUrl = ini.Get("ApiBaseUrl", c.ApiBaseUrl).Trim().TrimEnd('/');
            c.SyncIntervalSeconds = Clamp(Util.ParseInt(ini.Get("SyncIntervalSeconds", null), c.SyncIntervalSeconds), 1, 3600);
            c.RequestTimeoutSeconds = Clamp(Util.ParseInt(ini.Get("RequestTimeoutSeconds", null), c.RequestTimeoutSeconds), 2, 120);
            c.DuplicateWindowSeconds = Clamp(Util.ParseInt(ini.Get("DuplicateWindowSeconds", null), c.DuplicateWindowSeconds), 0, 3600);
            c.HeartbeatIntervalSeconds = Clamp(Util.ParseInt(ini.Get("HeartbeatIntervalSeconds", null), c.HeartbeatIntervalSeconds), 10, 3600);
            c.TabCompletesScan = Util.ParseBool(ini.Get("TabCompletesScan", null), c.TabCompletesScan);
            c.SoundEnabled = Util.ParseBool(ini.Get("SoundEnabled", null), c.SoundEnabled);
            c.ScannerMode = ini.Get("ScannerMode", c.ScannerMode).Trim().ToUpper();
            c.DataDirectory = ini.Get("DataDirectory", c.DataDirectory).Trim();
            c.AdminPinHash = ini.Get("AdminPinHash", c.AdminPinHash).Trim();
            return c;
        }

        public void Save()
        {
            IniFile ini = new IniFile();
            ini.Set("DeviceId", DeviceId);
            ini.Set("DeviceName", DeviceName);
            ini.Set("ApiBaseUrl", ApiBaseUrl);
            ini.Set("SyncIntervalSeconds", SyncIntervalSeconds.ToString());
            ini.Set("RequestTimeoutSeconds", RequestTimeoutSeconds.ToString());
            ini.Set("DuplicateWindowSeconds", DuplicateWindowSeconds.ToString());
            ini.Set("HeartbeatIntervalSeconds", HeartbeatIntervalSeconds.ToString());
            ini.Set("TabCompletesScan", TabCompletesScan ? "true" : "false");
            ini.Set("SoundEnabled", SoundEnabled ? "true" : "false");
            ini.Set("ScannerMode", ScannerMode);
            ini.Set("DataDirectory", DataDirectory);
            ini.Set("AdminPinHash", AdminPinHash);
            ini.Save(_path, "Givova Coleta - configuracao do coletor");
        }

        public string ResolveDataDirectory(string appDirectory)
        {
            return DataDirectory.Length > 0 ? DataDirectory : System.IO.Path.Combine(appDirectory, "data");
        }

        public bool CheckPin(string pin)
        {
            if (AdminPinHash.Length == 0) return pin == DefaultPin;
            string[] parts = AdminPinHash.Split(':');
            return parts.Length == 2 && HashPin(pin, parts[0]) == parts[1];
        }

        public void SetPin(string pin)
        {
            string salt = Guid.NewGuid().ToString("N").Substring(0, 16);
            AdminPinHash = salt + ":" + HashPin(pin, salt);
        }

        private static string HashPin(string pin, string salt)
        {
            // SHA1 is what .NET CF 2.0/3.5 reliably provides. The PIN only protects local settings.
            SHA1CryptoServiceProvider sha = new SHA1CryptoServiceProvider();
            byte[] data = Encoding.UTF8.GetBytes(salt + ":" + pin);
            for (int i = 0; i < 1000; i++) data = sha.ComputeHash(data);
            StringBuilder sb = new StringBuilder(40);
            foreach (byte b in data) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        private static int Clamp(int v, int min, int max)
        {
            return v < min ? min : (v > max ? max : v);
        }
    }
}
