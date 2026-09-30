using System;
using System.Windows.Forms;
using GivovaCollector.Core;

namespace GivovaCollector.Scanner
{
    /// <summary>
    /// Integration point for a manufacturer scanner SDK (Zebra/Motorola/Symbol EMDK, Honeywell/Intermec
    /// SDK, Datalogic SDK...). NO vendor API is implemented here on purpose: the exact SDK and its
    /// assemblies must match the physical device model and OS image.
    ///
    /// To integrate: create a subclass in its own file (e.g. Scanner\Vendors\ZebraScannerProvider.cs),
    /// reference the vendor assembly only from that file, enable the decoder in Start(), release it in
    /// Stop(), and call OnScanned(data, symbology) from the SDK read-complete callback. Then select it
    /// in ScannerFactory.Create for ScannerMode=VENDOR.
    /// </summary>
    public abstract class VendorScannerProvider : IScannerProvider
    {
        public event EventHandler<BarcodeScannedEventArgs> BarcodeScanned;

        public abstract string Name { get; }
        public abstract void Start();
        public abstract void Stop();

        /// <summary>Call from the SDK callback (any thread).</summary>
        protected void OnScanned(string data, string symbology)
        {
            EventHandler<BarcodeScannedEventArgs> handler = BarcodeScanned;
            if (handler != null) handler(this, new BarcodeScannedEventArgs(data, symbology));
        }
    }

    public static class ScannerFactory
    {
        /// <summary>
        /// Returns the configured provider. VENDOR falls back to keyboard wedge (with a log line)
        /// until a vendor SDK integration is added, so the collector always has a working input.
        /// </summary>
        public static IScannerProvider Create(AppConfig config, TextBox wedgeInput)
        {
            if (config.ScannerMode == "VENDOR")
            {
                Logger.Warn("ScannerMode=VENDOR but no vendor SDK is integrated; using keyboard wedge");
            }
            return new KeyboardWedgeScannerProvider(wedgeInput, config.TabCompletesScan);
        }
    }
}
