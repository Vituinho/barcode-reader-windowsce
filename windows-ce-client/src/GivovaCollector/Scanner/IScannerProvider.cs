using System;

namespace GivovaCollector.Scanner
{
    public class BarcodeScannedEventArgs : EventArgs
    {
        /// <summary>Exactly what the scanner delivered (may include terminator characters).</summary>
        public readonly string RawData;
        /// <summary>Symbology name when the source knows it (vendor SDKs); null for keyboard wedge.</summary>
        public readonly string Symbology;

        public BarcodeScannedEventArgs(string rawData, string symbology)
        {
            RawData = rawData;
            Symbology = symbology;
        }
    }

    /// <summary>
    /// Source of barcode reads. Implementations may raise BarcodeScanned on any thread;
    /// consumers marshal to the UI thread.
    /// </summary>
    public interface IScannerProvider
    {
        event EventHandler<BarcodeScannedEventArgs> BarcodeScanned;

        string Name { get; }
        void Start();
        void Stop();
    }
}
