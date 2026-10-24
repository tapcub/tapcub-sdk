package com.tapcub.server;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * A batch that could not be delivered, or events the server rejected.
 *
 * <p>{@link #getCode()}: the server code (NO_API_KEY, BAD_API_KEY, VALIDATION …), HTTP_&lt;status&gt;, NETWORK,
 * EVENT_REJECTED or QUEUE_FULL.
 */
public class TapCubException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  private final String code;
  private final int status;
  private final transient List<Map<String, Object>> events;
  private final transient List<Map<String, Object>> results;
  transient double retryAfterSeconds;

  public TapCubException(String message, String code, int status, List<Map<String, Object>> events, List<Map<String, Object>> results, Throwable cause) {
    super(message, cause);
    this.code = code;
    this.status = status;
    this.events = events == null ? Collections.<Map<String, Object>>emptyList() : Collections.unmodifiableList(events);
    this.results = results;
  }

  public String getCode() {
    return code;
  }

  /** HTTP status, 0 when there was no response. */
  public int getStatus() {
    return status;
  }

  /** The events that were not stored. */
  public List<Map<String, Object>> getEvents() {
    return events;
  }

  /** Per-event results ({@code index}, {@code ok}, {@code warnings}) for EVENT_REJECTED; otherwise null. */
  public List<Map<String, Object>> getResults() {
    return results;
  }
}
