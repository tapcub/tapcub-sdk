package com.tapcub.server;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Where the user came from. Same fields as the browser's {@code tapcub.getAttribution()}: if your web layer already
 * parsed that JSON into a {@code Map}, pass the map to {@link TrackOptions#context(Map)} under {@code "campaign"} instead.
 */
public final class Campaign {
  private final Map<String, Object> fields = new LinkedHashMap<>();

  public Campaign source(String v) { return put("source", v); }
  public Campaign medium(String v) { return put("medium", v); }
  public Campaign name(String v) { return put("name", v); }
  public Campaign term(String v) { return put("term", v); }
  public Campaign content(String v) { return put("content", v); }
  /** Partner / referral code. */
  public Campaign ref(String v) { return put("ref", v); }
  /** {@code type:value}, for example {@code gclid:Cj0K…}. */
  public Campaign clickId(String v) { return put("click_id", v); }
  public Campaign landingUrl(String v) { return put("landing_url", v); }
  public Campaign referrer(String v) { return put("referrer", v); }
  /** When the user landed, in milliseconds. */
  public Campaign touchedAt(long millis) { return put("touched_at", millis); }

  private Campaign put(String k, Object v) {
    if (v == null) fields.remove(k);
    else fields.put(k, v);
    return this;
  }

  /** The campaign in API field names. */
  public Map<String, Object> toMap() {
    return new LinkedHashMap<>(fields);
  }
}
