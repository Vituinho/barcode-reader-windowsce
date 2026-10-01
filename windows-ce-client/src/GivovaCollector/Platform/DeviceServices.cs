using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace GivovaCollector.Platform
{
    public enum FeedbackKind
    {
        Saved,
        SavedOffline,
        Error
    }

    /// <summary>
    /// Everything that touches the OS. Windows CE entry points live in coredll.dll; the desktop
    /// simulator uses kernel32/user32/winmm. P/Invoke targets resolve only when called, so the same
    /// binary runs on both, and every call is optional (wrapped, never fatal).
    /// </summary>
    public static class DeviceServices
    {
        public static bool IsWindowsCE
        {
            get { return Environment.OSVersion.Platform == PlatformID.WinCE; }
        }

        public static string AppDirectory
        {
            get
            {
                string codeBase = Assembly.GetExecutingAssembly().GetName().CodeBase;
                if (codeBase.StartsWith("file:")) codeBase = new Uri(codeBase).LocalPath;
                return Path.GetDirectoryName(codeBase);
            }
        }

        /// <summary>Asks the OS to commit file buffers to storage (best effort).</summary>
        public static void FlushToStorage(FileStream fs)
        {
            try
            {
                FlushHandle(fs);
            }
            catch (Exception)
            {
                // Handle property or native call unavailable: FileStream.Flush() already ran.
            }
        }

        private static void FlushHandle(FileStream fs)
        {
            // FileStream.Handle is obsolete on desktop but is what .NET CF 3.5 provides (no SafeFileHandle).
#pragma warning disable 618
            IntPtr handle = fs.Handle;
#pragma warning restore 618
            if (IsWindowsCE) CeFlushFileBuffers(handle);
            else DesktopFlushFileBuffers(handle);
        }

        // ---- TLS ----------------------------------------------------------------------------

        /// <summary>
        /// Desktop simulator only: the exe targets .NET 4.0, whose default protocols are SSL3/TLS 1.0, which modern
        /// HTTPS hosts (e.g. Railway) refuse. Enables TLS 1.2 (numeric 3072: the enum member does not exist in the
        /// 4.0 reference assemblies) and drops SSL3. Certificate validation is untouched.
        /// On Windows CE / .NET CF this compiles to nothing: TLS support comes from the device OS (Schannel).
        /// </summary>
        public static void EnsureModernTls()
        {
#if DESKTOP
            try
            {
                const int Ssl3 = 48;
                const int Tls12 = 3072;
                int current = (int)System.Net.ServicePointManager.SecurityProtocol;
                if (current != 0) // 0 = SystemDefault (newer runtimes): the OS already negotiates TLS 1.2+
                    System.Net.ServicePointManager.SecurityProtocol = (System.Net.SecurityProtocolType)((current & ~Ssl3) | Tls12);
            }
            catch (NotSupportedException)
            {
                // Runtime without TLS 1.2 (.NET 4.0 without 4.5+ installed): requests will report SecureChannelFailure.
            }
#endif
        }

        // ---- sound --------------------------------------------------------------------------

        private const int MB_OK = 0x00000000;
        private const int MB_ICONHAND = 0x00000010;
        private const int MB_ICONASTERISK = 0x00000040;
        private const int SND_ASYNC = 0x0001;
        private const int SND_NODEFAULT = 0x0002;
        private const int SND_FILENAME = 0x00020000;

        /// <summary>
        /// Optional feedback. If sounds\ok.wav, sounds\offline.wav or sounds\error.wav exist next to the
        /// executable they are played; otherwise a system beep type is used.
        /// </summary>
        public static void PlayFeedback(FeedbackKind kind)
        {
            try
            {
                string file = kind == FeedbackKind.Saved ? "ok.wav" : (kind == FeedbackKind.SavedOffline ? "offline.wav" : "error.wav");
                string path = Path.Combine(Path.Combine(AppDirectory, "sounds"), file);
                if (File.Exists(path))
                {
                    if (IsWindowsCE) CePlaySound(path, IntPtr.Zero, SND_ASYNC | SND_NODEFAULT | SND_FILENAME);
                    else DesktopPlaySound(path, IntPtr.Zero, SND_ASYNC | SND_NODEFAULT | SND_FILENAME);
                    return;
                }
                int type = kind == FeedbackKind.Saved ? MB_OK : (kind == FeedbackKind.SavedOffline ? MB_ICONASTERISK : MB_ICONHAND);
                if (IsWindowsCE) CeMessageBeep(type);
                else DesktopMessageBeep(type);
            }
            catch (Exception)
            {
                // no sound support on this device
            }
        }

        // ---- battery ------------------------------------------------------------------------

        /// <summary>Battery percentage 0-100, or -1 when unavailable (desktop, unsupported device).</summary>
        public static int GetBatteryPercent()
        {
            if (!IsWindowsCE) return -1;
            try
            {
                return ReadCeBattery();
            }
            catch (Exception)
            {
                return -1;
            }
        }

        private static int ReadCeBattery()
        {
            // SYSTEM_POWER_STATUS_EX: ACLineStatus, BatteryFlag, BatteryLifePercent, Reserved1, ... (24 bytes)
            byte[] status = new byte[24];
            if (!CeGetSystemPowerStatusEx(status, true)) return -1;
            int percent = status[2];
            return percent <= 100 ? percent : -1; // 255 = unknown
        }

        // ---- native -------------------------------------------------------------------------

        [DllImport("coredll.dll", EntryPoint = "FlushFileBuffers", SetLastError = true)]
        private static extern bool CeFlushFileBuffers(IntPtr handle);

        [DllImport("kernel32.dll", EntryPoint = "FlushFileBuffers", SetLastError = true)]
        private static extern bool DesktopFlushFileBuffers(IntPtr handle);

        [DllImport("coredll.dll", EntryPoint = "MessageBeep")]
        private static extern bool CeMessageBeep(int type);

        [DllImport("user32.dll", EntryPoint = "MessageBeep")]
        private static extern bool DesktopMessageBeep(int type);

        [DllImport("coredll.dll", EntryPoint = "PlaySound", CharSet = CharSet.Unicode)]
        private static extern bool CePlaySound(string sound, IntPtr module, int flags);

        [DllImport("winmm.dll", EntryPoint = "PlaySoundW", CharSet = CharSet.Unicode)]
        private static extern bool DesktopPlaySound(string sound, IntPtr module, int flags);

        [DllImport("coredll.dll", EntryPoint = "GetSystemPowerStatusEx")]
        private static extern bool CeGetSystemPowerStatusEx(byte[] status, bool update);
    }
}
