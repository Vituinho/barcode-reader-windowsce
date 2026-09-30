using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace GivovaCollector.Core
{
    /// <summary>
    /// Minimal JSON support for .NET Compact Framework 3.5 (no external libraries).
    /// Objects parse to Dictionary&lt;string, object&gt;, arrays to List&lt;object&gt;,
    /// numbers to double, plus string, bool and null.
    /// </summary>
    public static class Json
    {
        public static string Quote(string value)
        {
            if (value == null) return "null";
            StringBuilder sb = new StringBuilder(value.Length + 8);
            sb.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        // Escape control and non-ASCII characters so the payload is pure ASCII on the wire.
                        if (c < 0x20 || c > 0x7E)
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        public static object Parse(string text)
        {
            if (text == null) throw new FormatException("empty JSON");
            Parser p = new Parser(text);
            p.SkipWs();
            object value = p.ReadValue();
            p.SkipWs();
            if (!p.AtEnd) throw new FormatException("trailing characters in JSON");
            return value;
        }

        public static Dictionary<string, object> ParseObject(string text)
        {
            Dictionary<string, object> obj = Parse(text) as Dictionary<string, object>;
            if (obj == null) throw new FormatException("JSON object expected");
            return obj;
        }

        public static string GetString(Dictionary<string, object> obj, string key)
        {
            object v;
            if (obj == null || !obj.TryGetValue(key, out v) || v == null) return null;
            if (v is string) return (string)v;
            if (v is double) return ((double)v).ToString(CultureInfo.InvariantCulture);
            if (v is bool) return ((bool)v) ? "true" : "false";
            return null;
        }

        public static bool GetBool(Dictionary<string, object> obj, string key, bool fallback)
        {
            object v;
            if (obj == null || !obj.TryGetValue(key, out v) || !(v is bool)) return fallback;
            return (bool)v;
        }

        public static int GetInt(Dictionary<string, object> obj, string key, int fallback)
        {
            object v;
            if (obj == null || !obj.TryGetValue(key, out v) || !(v is double)) return fallback;
            return (int)(double)v;
        }

        private class Parser
        {
            private readonly string _s;
            private int _i;

            public Parser(string s) { _s = s; }

            public bool AtEnd { get { return _i >= _s.Length; } }

            public void SkipWs()
            {
                while (_i < _s.Length && (_s[_i] == ' ' || _s[_i] == '\t' || _s[_i] == '\r' || _s[_i] == '\n')) _i++;
            }

            private char Peek()
            {
                if (_i >= _s.Length) throw new FormatException("unexpected end of JSON");
                return _s[_i];
            }

            public object ReadValue()
            {
                char c = Peek();
                if (c == '{') return ReadObject();
                if (c == '[') return ReadArray();
                if (c == '"') return ReadString();
                if (c == 't') { Expect("true"); return true; }
                if (c == 'f') { Expect("false"); return false; }
                if (c == 'n') { Expect("null"); return null; }
                return ReadNumber();
            }

            private void Expect(string word)
            {
                if (_i + word.Length > _s.Length || _s.Substring(_i, word.Length) != word)
                    throw new FormatException("invalid JSON literal");
                _i += word.Length;
            }

            private Dictionary<string, object> ReadObject()
            {
                Dictionary<string, object> obj = new Dictionary<string, object>();
                _i++; // {
                SkipWs();
                if (Peek() == '}') { _i++; return obj; }
                while (true)
                {
                    SkipWs();
                    if (Peek() != '"') throw new FormatException("JSON key expected");
                    string key = ReadString();
                    SkipWs();
                    if (Peek() != ':') throw new FormatException("':' expected");
                    _i++;
                    SkipWs();
                    obj[key] = ReadValue();
                    SkipWs();
                    char c = Peek();
                    _i++;
                    if (c == '}') return obj;
                    if (c != ',') throw new FormatException("',' or '}' expected");
                }
            }

            private List<object> ReadArray()
            {
                List<object> list = new List<object>();
                _i++; // [
                SkipWs();
                if (Peek() == ']') { _i++; return list; }
                while (true)
                {
                    SkipWs();
                    list.Add(ReadValue());
                    SkipWs();
                    char c = Peek();
                    _i++;
                    if (c == ']') return list;
                    if (c != ',') throw new FormatException("',' or ']' expected");
                }
            }

            private string ReadString()
            {
                _i++; // opening quote
                StringBuilder sb = new StringBuilder();
                while (true)
                {
                    char c = Peek();
                    _i++;
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    char e = Peek();
                    _i++;
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_i + 4 > _s.Length) throw new FormatException("bad unicode escape");
                            sb.Append((char)Convert.ToInt32(_s.Substring(_i, 4), 16));
                            _i += 4;
                            break;
                        default: throw new FormatException("bad escape");
                    }
                }
            }

            private double ReadNumber()
            {
                int start = _i;
                while (_i < _s.Length && "+-0123456789.eE".IndexOf(_s[_i]) >= 0) _i++;
                if (start == _i) throw new FormatException("invalid JSON value");
                return double.Parse(_s.Substring(start, _i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }

    /// <summary>Builds a flat JSON object without reflection.</summary>
    public class JsonObjectBuilder
    {
        private readonly StringBuilder _sb = new StringBuilder(256);
        private bool _first = true;

        public JsonObjectBuilder() { _sb.Append('{'); }

        private void Key(string key)
        {
            if (!_first) _sb.Append(',');
            _first = false;
            _sb.Append(Json.Quote(key)).Append(':');
        }

        public JsonObjectBuilder Add(string key, string value) { Key(key); _sb.Append(Json.Quote(value)); return this; }

        public JsonObjectBuilder Add(string key, int value)
        {
            Key(key);
            _sb.Append(value.ToString(CultureInfo.InvariantCulture));
            return this;
        }

        public JsonObjectBuilder AddNullableInt(string key, int value, bool hasValue)
        {
            Key(key);
            _sb.Append(hasValue ? value.ToString(CultureInfo.InvariantCulture) : "null");
            return this;
        }

        public JsonObjectBuilder Add(string key, bool value) { Key(key); _sb.Append(value ? "true" : "false"); return this; }

        public override string ToString() { return _sb.ToString() + "}"; }
    }
}
