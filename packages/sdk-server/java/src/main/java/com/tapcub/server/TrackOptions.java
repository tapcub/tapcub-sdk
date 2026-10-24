package com.tapcub.server;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Optional fields of {@link TapCub#track(String, TrackOptions)}. Setters return {@code this}. */
public final class TrackOptions {
  String loginId;
  String loginIdType;
  String deviceId;
  String sessionId;
  String insertId;
  Long time;
  String group;
  Map<String, Object> properties;
  Map<String, Object> context;

  public TrackOptions loginId(String v) { loginId = v; return this; }
  /** One of login, email, mobile, unionid, openid, custom; email and mobile login IDs are hashed before sending. */
  public TrackOptions loginIdType(String v) { loginIdType = v; return this; }
  public TrackOptions deviceId(String v) { deviceId = v; return this; }
  public TrackOptions sessionId(String v) { sessionId = v; return this; }
  /** Idempotency key (≤36). Not generated for you: pass a natural key such as the order ID. */
  public TrackOptions insertId(String v) { insertId = v; return this; }
  /** Milliseconds since the epoch; defaults to now. */
  public TrackOptions time(long millis) { time = millis; return this; }
  public TrackOptions time(Instant t) { time = t == null ? null : t.toEpochMilli(); return this; }
  /** Account key {@code type:id}, for example {@code company:acme}. */
  public TrackOptions group(String v) { group = v; return this; }

  public TrackOptions properties(Map<String, ?> v) {
    properties = v == null ? null : new LinkedHashMap<>(v);
    return this;
  }

  public TrackOptions property(String key, Object value) {
    if (properties == null) properties = new LinkedHashMap<>();
    properties.put(key, value);
    return this;
  }

  /**
   * Request context in API field names: {@code ip}, {@code user_agent}, {@code url}, {@code platform}, {@code country},
   * {@code lang}, {@code campaign}. Pass {@code ip} and {@code user_agent} to let TapCub infer the visit source.
   */
  public TrackOptions context(Map<String, ?> v) {
    context = v == null ? null : new LinkedHashMap<>(v);
    return this;
  }

  public TrackOptions ip(String v) { return ctx("ip", v); }
  public TrackOptions userAgent(String v) { return ctx("user_agent", v); }
  public TrackOptions url(String v) { return ctx("url", v); }
  public TrackOptions campaign(Campaign v) { return ctx("campaign", v == null ? null : v.toMap()); }

  private TrackOptions ctx(String k, Object v) {
    if (context == null) context = new LinkedHashMap<>();
    context.put(k, v);
    return this;
  }
}
