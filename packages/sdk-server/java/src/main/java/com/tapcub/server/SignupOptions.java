package com.tapcub.server;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Optional fields of {@link TapCub#trackSignup(String, SignupOptions)}. Setters return {@code this}. */
public final class SignupOptions {
  String deviceId;
  String sessionId;
  String insertId;
  Long time;
  String invitedBy;
  Map<String, Object> properties;
  Map<String, Object> context;

  /** The anonymous device to link to the new login ID. */
  public SignupOptions deviceId(String v) { deviceId = v; return this; }
  public SignupOptions sessionId(String v) { sessionId = v; return this; }
  public SignupOptions insertId(String v) { insertId = v; return this; }
  public SignupOptions time(long millis) { time = millis; return this; }
  public SignupOptions time(Instant t) { time = t == null ? null : t.toEpochMilli(); return this; }
  /** Login ID of the user who invited this one; sent as {@code properties.$invited_by}. */
  public SignupOptions invitedBy(String v) { invitedBy = v; return this; }

  public SignupOptions properties(Map<String, ?> v) {
    properties = v == null ? null : new LinkedHashMap<>(v);
    return this;
  }

  public SignupOptions property(String key, Object value) {
    if (properties == null) properties = new LinkedHashMap<>();
    properties.put(key, value);
    return this;
  }

  /** Request context in API field names (see {@link TrackOptions#context(Map)}). */
  public SignupOptions context(Map<String, ?> v) {
    context = v == null ? null : new LinkedHashMap<>(v);
    return this;
  }

  public SignupOptions campaign(Campaign v) {
    if (context == null) context = new LinkedHashMap<>();
    context.put("campaign", v == null ? null : v.toMap());
    return this;
  }
}
