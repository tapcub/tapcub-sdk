package com.tapcub.server.internal;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON codec so the SDK has no runtime dependencies. Output is compact, keeps map order and does not escape
 * {@code /} or non-ASCII characters (same as JavaScript's JSON.stringify).
 *
 * <p>Internal API: may change without notice.
 */
public final class Json {
  private Json() {}

  public static String write(Object v) {
    StringBuilder sb = new StringBuilder();
    write(sb, v);
    return sb.toString();
  }

  private static void write(StringBuilder sb, Object v) {
    if (v == null) {
      sb.append("null");
    } else if (v instanceof String || v instanceof Character) {
      string(sb, v.toString());
    } else if (v instanceof Boolean) {
      sb.append(v.toString());
    } else if (v instanceof Number) {
      number(sb, (Number) v);
    } else if (v instanceof Map) {
      sb.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
        if (!first) sb.append(',');
        first = false;
        string(sb, String.valueOf(e.getKey()));
        sb.append(':');
        write(sb, e.getValue());
      }
      sb.append('}');
    } else if (v instanceof Collection) {
      sb.append('[');
      boolean first = true;
      for (Object o : (Collection<?>) v) {
        if (!first) sb.append(',');
        first = false;
        write(sb, o);
      }
      sb.append(']');
    } else if (v.getClass().isArray()) {
      sb.append('[');
      int n = java.lang.reflect.Array.getLength(v);
      for (int i = 0; i < n; i++) {
        if (i > 0) sb.append(',');
        write(sb, java.lang.reflect.Array.get(v, i));
      }
      sb.append(']');
    } else if (v instanceof Date) {
      string(sb, ((Date) v).toInstant().toString());
    } else if (v instanceof TemporalAccessor) {
      string(sb, v.toString());
    } else {
      string(sb, v.toString());
    }
  }

  private static void number(StringBuilder sb, Number n) {
    if (n instanceof Double || n instanceof Float) {
      double d = n.doubleValue();
      if (Double.isNaN(d) || Double.isInfinite(d)) {
        sb.append("null");
      } else if (d == Math.rint(d) && Math.abs(d) < 1e15) {
        sb.append((long) d); // 99.0 → 99（同 JavaScript）
      } else {
        sb.append(n instanceof Float ? Float.toString(n.floatValue()) : Double.toString(d));
      }
    } else if (n instanceof BigDecimal) {
      sb.append(((BigDecimal) n).toString());
    } else {
      sb.append(n.toString());
    }
  }

  private static void string(StringBuilder sb, String s) {
    sb.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"':
          sb.append("\\\"");
          break;
        case '\\':
          sb.append("\\\\");
          break;
        case '\n':
          sb.append("\\n");
          break;
        case '\r':
          sb.append("\\r");
          break;
        case '\t':
          sb.append("\\t");
          break;
        case '\b':
          sb.append("\\b");
          break;
        case '\f':
          sb.append("\\f");
          break;
        default:
          boolean loneSurrogate =
              (Character.isHighSurrogate(c) && (i + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(i + 1))))
                  || (Character.isLowSurrogate(c) && (i == 0 || !Character.isHighSurrogate(s.charAt(i - 1))));
          if (c < 0x20 || loneSurrogate) {
            sb.append(String.format("\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
      }
    }
    sb.append('"');
  }

  // ---------------- parsing ----------------

  /** Parses JSON into Map (LinkedHashMap) / List / String / Long / Double / Boolean / null. */
  public static Object parse(String s) {
    Parser p = new Parser(s);
    p.ws();
    Object v = p.value();
    p.ws();
    if (p.i != s.length()) throw new IllegalArgumentException("trailing characters at " + p.i);
    return v;
  }

  private static final class Parser {
    final String s;
    int i;

    Parser(String s) {
      this.s = s;
    }

    void ws() {
      while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
    }

    IllegalArgumentException err(String m) {
      return new IllegalArgumentException("invalid JSON: " + m + " at " + i);
    }

    Object value() {
      if (i >= s.length()) throw err("unexpected end");
      char c = s.charAt(i);
      switch (c) {
        case '{':
          return object();
        case '[':
          return array();
        case '"':
          return str();
        case 't':
          return literal("true", Boolean.TRUE);
        case 'f':
          return literal("false", Boolean.FALSE);
        case 'n':
          return literal("null", null);
        default:
          return num();
      }
    }

    Object literal(String word, Object v) {
      if (!s.startsWith(word, i)) throw err("unexpected token");
      i += word.length();
      return v;
    }

    Map<String, Object> object() {
      Map<String, Object> m = new LinkedHashMap<>();
      i++;
      ws();
      if (i < s.length() && s.charAt(i) == '}') {
        i++;
        return m;
      }
      while (true) {
        ws();
        String k = str();
        ws();
        if (i >= s.length() || s.charAt(i) != ':') throw err("expected :");
        i++;
        ws();
        m.put(k, value());
        ws();
        if (i >= s.length()) throw err("unexpected end");
        char c = s.charAt(i++);
        if (c == '}') return m;
        if (c != ',') throw err("expected , or }");
      }
    }

    List<Object> array() {
      List<Object> l = new ArrayList<>();
      i++;
      ws();
      if (i < s.length() && s.charAt(i) == ']') {
        i++;
        return l;
      }
      while (true) {
        ws();
        l.add(value());
        ws();
        if (i >= s.length()) throw err("unexpected end");
        char c = s.charAt(i++);
        if (c == ']') return l;
        if (c != ',') throw err("expected , or ]");
      }
    }

    String str() {
      if (i >= s.length() || s.charAt(i) != '"') throw err("expected string");
      i++;
      StringBuilder sb = new StringBuilder();
      while (true) {
        if (i >= s.length()) throw err("unterminated string");
        char c = s.charAt(i++);
        if (c == '"') return sb.toString();
        if (c != '\\') {
          sb.append(c);
          continue;
        }
        if (i >= s.length()) throw err("bad escape");
        char e = s.charAt(i++);
        switch (e) {
          case '"':
          case '\\':
          case '/':
            sb.append(e);
            break;
          case 'b':
            sb.append('\b');
            break;
          case 'f':
            sb.append('\f');
            break;
          case 'n':
            sb.append('\n');
            break;
          case 'r':
            sb.append('\r');
            break;
          case 't':
            sb.append('\t');
            break;
          case 'u':
            if (i + 4 > s.length()) throw err("bad unicode escape");
            sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
            i += 4;
            break;
          default:
            throw err("bad escape");
        }
      }
    }

    Object num() {
      int start = i;
      if (i < s.length() && (s.charAt(i) == '-' || s.charAt(i) == '+')) i++;
      while (i < s.length() && "0123456789.eE+-".indexOf(s.charAt(i)) >= 0) i++;
      String t = s.substring(start, i);
      if (t.isEmpty()) throw err("unexpected character");
      if (t.indexOf('.') < 0 && t.indexOf('e') < 0 && t.indexOf('E') < 0) {
        BigInteger b = new BigInteger(t);
        return b.bitLength() < 64 ? (Object) b.longValue() : b;
      }
      return Double.parseDouble(t);
    }
  }
}
