using System.Text;

namespace GivovaCollector.Core
{
    /// <summary>CRC-32 (IEEE) used to detect torn or corrupted journal lines.</summary>
    public static class Crc32
    {
        private static readonly uint[] Table = BuildTable();

        private static uint[] BuildTable()
        {
            uint[] table = new uint[256];
            for (uint i = 0; i < 256; i++)
            {
                uint c = i;
                for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                table[i] = c;
            }
            return table;
        }

        public static uint Compute(string text)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            uint crc = 0xFFFFFFFFu;
            for (int i = 0; i < bytes.Length; i++) crc = Table[(crc ^ bytes[i]) & 0xFF] ^ (crc >> 8);
            return crc ^ 0xFFFFFFFFu;
        }

        public static string Hex(string text)
        {
            return Compute(text).ToString("x8");
        }
    }
}
