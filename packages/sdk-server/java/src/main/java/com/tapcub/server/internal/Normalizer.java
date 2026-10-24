package com.tapcub.server.internal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Event normalization shared by every TapCub server SDK (rules: test-vectors/track/README.md). Java strings are
 * UTF-16 like the server's length checks, so {@link String#length()} is the right measure.
 *
 * <p>Internal API: may change without notice.
 */
public final class Normalizer {
  private Normalizer() {}

  public static final List<String> LOGIN_ID_TYPES = Arrays.asList("login", "email", "mobile", "unionid", "openid", "custom");
  public static final List<String> PLATFORMS =
      Arrays.asList("web", "mp_weixin", "mp_alipay", "mp_bytedance", "mp_baidu", "mp_kuaishou", "mp_qq", "android", "ios", "harmony", "tvos", "watchos", "macos", "windows", "linux", "server", "import");
  private static final Pattern GROUP_KEY = Pattern.compile("^[a-z][a-z0-9_]{0,23}:[A-Za-z0-9_@.\\-]{1,80}$");
  private static final Pattern GROUP_TYPE = Pattern.compile("^[a-z][a-z0-9_]{0,23}$");
  private static final Pattern HEX64 = Pattern.compile("^[a-fA-F0-9]{64}$");
  private static final Pattern COUNTRY = Pattern.compile("^[A-Za-z]{2}$");
  private static final String[][] CAMPAIGN_LIMITS = {
    {"source", "100"}, {"medium", "100"}, {"name", "100"}, {"term", "100"}, {"content", "100"},
    {"ref", "64"}, {"click_id", "1000"}, {"landing_url", "2000"}, {"referrer", "2000"},
  };

  public static String sha256(String s) {
    try {
      byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder(64);
      for (byte b : d) sb.append(String.format("%02x", b & 0xff));
      return sb.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  /** At most n UTF-16 code units, never splitting a surrogate pair. */
  public static String cut(String s, int n) {
    if (s.length() <= n) return s;
    return s.substring(0, Character.isHighSurrogate(s.charAt(n - 1)) ? n - 1 : n);
  }

  private static IllegalArgumentException arg(String m) {
    return new IllegalArgumentException("TapCub: " + m);
  }

  public static String requireText(String name, Object v, int max) {
    String s = v == null ? "" : v.toString().trim();
    if (s.isEmpty()) throw arg(name + " is required");
    if (max > 0 && s.length() > max) throw arg(name + " must be at most " + max + " characters");
    return s;
  }

  public static String optionalText(String name, Object v, int max) {
    if (v == null) return null;
    String s = v.toString().trim();
    if (s.isEmpty()) return null;
    if (s.length() > max) throw arg(name + " must be at most " + max + " characters");
    return s;
  }

  public static String eventName(Object v) {
    String s = v == null ? "" : v.toString().trim();
    if (s.isEmpty()) throw arg("event is required");
    return cut(s, 100);
  }

  public static String loginIdType(String v) {
    if (v == null) return null;
    if (!LOGIN_ID_TYPES.contains(v)) throw arg("loginIdType must be one of " + String.join(", ", LOGIN_ID_TYPES));
    return v;
  }

  public static String identityValue(String type, Object value) {
    String v = value == null ? "" : value.toString().trim();
    if ("email".equals(type) || "mobile".equals(type)) {
      String n = "email".equals(type) ? v.toLowerCase(Locale.ROOT) : v.replaceAll("[\\s-]", "");
      return HEX64.matcher(n).matches() ? n.toLowerCase(Locale.ROOT) : sha256(n);
    }
    return v;
  }

  public static Map<String, Object> identities(Map<String, ?> v) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (v == null) return out;
    for (Map.Entry<String, ?> e : v.entrySet()) {
      String k = e.getKey();
      if (!LOGIN_ID_TYPES.contains(k)) throw arg("unknown identity type \"" + k + "\"");
      if (e.getValue() == null || e.getValue().toString().trim().isEmpty()) continue;
      out.put(k, identityValue(k, e.getValue()));
    }
    return out;
  }

  public static String group(String v) {
    if (v == null) return null;
    if (!GROUP_KEY.matcher(v).matches()) throw arg("group must look like \"type:id\" (type: a-z, 0-9, _)");
    return v;
  }

  public static String groupKey(String type, String id) {
    String t = requireText("groupType", type, 0);
    if (!GROUP_TYPE.matcher(t).matches()) throw arg("groupType must start with a-z and contain only a-z, 0-9 and _ (at most 24)");
    return group(t + ":" + requireText("groupId", id, 0));
  }

  private static boolean finite(Object v) {
    if (v instanceof Double) return !((Double) v).isNaN() && !((Double) v).isInfinite();
    if (v instanceof Float) return !((Float) v).isNaN() && !((Float) v).isInfinite();
    return v instanceof Number;
  }

  /** Returns null to drop the value. */
  private static Object scalar(Object v) {
    if (v == null) return null;
    if (v instanceof String) return cut((String) v, 1000);
    if (v instanceof Boolean) return v;
    if (v instanceof Number) return finite(v) ? v : null;
    if (v instanceof Character || v instanceof Enum) return cut(v.toString(), 1000);
    if (v instanceof Date) return ((Date) v).toInstant().toString();
    if (v instanceof Instant || v instanceof TemporalAccessor) return v.toString();
    if (v instanceof Map || v instanceof Collection || v.getClass().isArray()) return cut(Json.write(v), 1000);
    return cut(v.toString(), 1000);
  }

  private static boolean isObjectList(Object v) {
    if (!(v instanceof Collection) || ((Collection<?>) v).isEmpty()) return false;
    for (Object o : (Collection<?>) v) if (!(o instanceof Map)) return false;
    return true;
  }

  public static Map<String, Object> properties(Map<String, ?> p) {
    if (p == null || p.isEmpty()) return null;
    Map<String, Object> out = new LinkedHashMap<>();
    for (Map.Entry<String, ?> e : p.entrySet()) {
      String key = cut(String.valueOf(e.getKey()), 50);
      Object v = e.getValue();
      if (isObjectList(v)) {
        List<Object> rows = new ArrayList<>();
        for (Object o : (Collection<?>) v) {
          if (rows.size() == 100) break;
          Map<String, Object> row = new LinkedHashMap<>();
          for (Map.Entry<?, ?> ie : ((Map<?, ?>) o).entrySet()) {
            Object s = scalar(ie.getValue());
            if (s != null) row.put(cut(String.valueOf(ie.getKey()), 50), s);
          }
          rows.add(row);
        }
        out.put(key, rows);
        continue;
      }
      Object s = scalar(v);
      if (s != null) out.put(key, s);
    }
    return out.isEmpty() ? null : out;
  }

  public static Map<String, Object> increment(Map<String, ?> p) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (p == null) return out;
    for (Map.Entry<String, ?> e : p.entrySet()) if (finite(e.getValue())) out.put(cut(e.getKey(), 50), e.getValue());
    return out;
  }

  public static Map<String, Object> append(Map<String, ?> p) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (p == null) return out;
    for (Map.Entry<String, ?> e : p.entrySet()) {
      Object v = e.getValue();
      Collection<?> items = v instanceof Collection ? (Collection<?>) v : v instanceof Object[] ? Arrays.asList((Object[]) v) : Arrays.asList(v);
      List<Object> keep = new ArrayList<>();
      for (Object x : items) {
        if (keep.size() == 20) break;
        if (x instanceof String || x instanceof Boolean || finite(x)) keep.add(x);
      }
      if (!keep.isEmpty()) out.put(cut(e.getKey(), 50), keep);
    }
    return out;
  }

  public static List<Object> unsetKeys(Collection<String> keys) {
    if (keys == null) throw arg("keys must be a list of property names");
    List<Object> out = new ArrayList<>();
    for (String k : keys) {
      if (out.size() == 50) break;
      if (k != null && !k.isEmpty()) out.add(cut(k, 50));
    }
    return out;
  }

  public static Map<String, Object> campaign(Object c) {
    if (!(c instanceof Map)) return null;
    Map<?, ?> m = (Map<?, ?>) c;
    Map<String, Object> out = new LinkedHashMap<>();
    for (String[] kv : CAMPAIGN_LIMITS) {
      Object v = m.get(kv[0]);
      if (v != null && !v.toString().isEmpty()) out.put(kv[0], cut(v.toString(), Integer.parseInt(kv[1])));
    }
    Object t = m.get("touched_at");
    if (t instanceof Number && finite(t)) out.put("touched_at", ((Number) t).longValue());
    return out.isEmpty() ? null : out;
  }

  public static Map<String, Object> context(Map<String, ?> c) {
    if (c == null) return null;
    Map<String, Object> out = new LinkedHashMap<>();
    String[][] cuts = {{"ip", "45"}, {"user_agent", "1000"}, {"url", "2000"}};
    for (String[] kv : cuts) {
      Object v = c.get(kv[0]);
      if (v != null && !v.toString().isEmpty()) out.put(kv[0], cut(v.toString(), Integer.parseInt(kv[1])));
    }
    Object platform = c.get("platform");
    if (platform instanceof String && PLATFORMS.contains(platform)) out.put("platform", platform);
    Object country = c.get("country");
    if (country instanceof String && COUNTRY.matcher((String) country).matches()) out.put("country", ((String) country).toUpperCase(Locale.ROOT));
    Object lang = c.get("lang");
    if (lang != null && !lang.toString().isEmpty()) out.put("lang", cut(lang.toString(), 12));
    Map<String, Object> camp = campaign(c.get("campaign"));
    if (camp != null) out.put("campaign", camp);
    return out.isEmpty() ? null : out;
  }

  /** Drops null fields. */
  public static Map<String, Object> compact(Map<String, Object> ev) {
    ev.values().removeIf(v -> v == null);
    return ev;
  }
}
