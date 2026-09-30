using System;
using System.Collections.Generic;
using System.IO;

namespace GivovaCollector.Tests
{
    public delegate void TestCase();

    /// <summary>Tiny dependency-free test runner (C# 3, runs on desktop .NET).</summary>
    public static class TestRunner
    {
        private static readonly List<KeyValuePair<string, TestCase>> Tests = new List<KeyValuePair<string, TestCase>>();

        public static void Add(string name, TestCase test)
        {
            Tests.Add(new KeyValuePair<string, TestCase>(name, test));
        }

        public static int Main(string[] args)
        {
            Core.Logger.Init(Path.Combine(Path.GetTempPath(), "givova-tests-logs"), 256 * 1024);
            CoreTests.Register();
            SyncTests.Register();
            int failed = 0;
            foreach (KeyValuePair<string, TestCase> t in Tests)
            {
                try
                {
                    t.Value();
                    Console.WriteLine("PASS " + t.Key);
                }
                catch (Exception ex)
                {
                    failed++;
                    Console.WriteLine("FAIL " + t.Key + ": " + ex.Message);
                }
            }
            Console.WriteLine();
            Console.WriteLine((Tests.Count - failed) + " passed, " + failed + " failed");
            return failed == 0 ? 0 : 1;
        }
    }

    public static class Assert
    {
        public static void True(bool condition, string message)
        {
            if (!condition) throw new Exception("assert failed: " + message);
        }

        public static void Equal(object expected, object actual, string message)
        {
            if (!object.Equals(expected, actual))
                throw new Exception(message + " (expected <" + expected + "> got <" + actual + ">)");
        }

        public static string TempDir()
        {
            string dir = Path.Combine(Path.GetTempPath(), "givova-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            return dir;
        }
    }
}
