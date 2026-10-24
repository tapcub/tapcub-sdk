package com.tapcub.server;

import com.tapcub.server.internal.Json;
import com.tapcub.server.internal.Normalizer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.zip.GZIPOutputStream;

/**
 * TapCub server-side client. Thread-safe; create one per process and {@link #close()} it on shutdown.
 *
 * <pre>{@code
 * TapCub tc = TapCub.builder(System.getenv("TAPCUB_API_KEY")).build();
 * tc.track("purchase", new TrackOptions().loginId("user-1").insertId("order-1").property("revenue", 19.9));
 * tc.close();
 * }</pre>
 *
 * <p>Consumers: {@link Mode#BATCH} (default) queues events and sends them from a background thread every
 * {@code flushInterval} or when {@code maxBatch} events are queued; {@link Mode#SYNC} sends on every call and throws
 * {@link TapCubException}; {@link Mode#DEBUG} is SYNC against {@code ?debug=1} (validated, nothing stored) and logs every
 * result. Argument errors throw {@link IllegalArgumentException} and queue nothing.
 */
public final class TapCub implements AutoCloseable {
  public static final String VERSION = "0.1.0";
  public static final String DEFAULT_ENDPOINT = "https://api.pathclue.com";
  private static final int MAX_BODY_BYTES = 1_000_000;
  private static final Logger LOG = Logger.getLogger("com.tapcub");

  /** How events are sent. */
  public enum Mode {
    BATCH,
    SYNC,
    DEBUG
  }

  /** Builder for {@link TapCub}. */
  public static final class Builder {
    private final String apiKey;
    private String endpoint;
    private Mode mode = Mode.BATCH;
    private int maxBatch = 200;
    private Duration flushInterval = Duration.ofSeconds(3);
    private int maxQueueSize = 10_000;
    private int maxRetries = 5;
    private Duration timeout = Duration.ofSeconds(10);
    private boolean gzip;
    private boolean flushOnShutdown = true;
    private Consumer<TapCubException> onError;
    private Logger logger = LOG;
    private HttpClient httpClient;
    private long retryBaseMillis = 500;

    private Builder(String apiKey) {
      this.apiKey = apiKey;
    }

    /** Leave unset: the TapCub ingest API is built in. Set it only for a dedicated address TapCub gives you. */
    public Builder endpoint(String v) { endpoint = v; return this; }
    public Builder mode(Mode v) { mode = v; return this; }
    /** Events per request, 1–1000. Default 200. */
    public Builder maxBatch(int v) { maxBatch = v; return this; }
    /** Default 3 seconds. */
    public Builder flushInterval(Duration v) { flushInterval = v; return this; }
    /** Default 10,000; the oldest events are dropped beyond it. */
    public Builder maxQueueSize(int v) { maxQueueSize = v; return this; }
    /** Retries for network errors, 5xx and 429. Default 5. */
    public Builder maxRetries(int v) { maxRetries = v; return this; }
    /** Per request. Default 10 seconds. */
    public Builder timeout(Duration v) { timeout = v; return this; }
    /** Send {@code Content-Encoding: gzip}. Default false. */
    public Builder gzip(boolean v) { gzip = v; return this; }
    /** Flush from a JVM shutdown hook (batch mode). Default true. */
    public Builder flushOnShutdown(boolean v) { flushOnShutdown = v; return this; }
    /** Receives background send failures. Default: logged at WARNING. */
    public Builder onError(Consumer<TapCubException> v) { onError = v; return this; }
    /** Default {@code java.util.logging.Logger.getLogger("com.tapcub")}. */
    public Builder logger(Logger v) { logger = v; return this; }
    /** Custom HTTP client (proxies, TLS). */
    public Builder httpClient(HttpClient v) { httpClient = v; return this; }

    Builder retryBaseMillis(long v) { retryBaseMillis = v; return this; }

    public TapCub build() {
      return new TapCub(this);
    }
  }

  public static Builder builder(String apiKey) {
    return new Builder(apiKey);
  }

  private final String apiKey;
  private final String endpoint;
  private final Mode mode;
  private final int maxBatch;
  private final int maxQueueSize;
  private final int maxRetries;
  private final Duration timeout;
  private final boolean gzip;
  private final Consumer<TapCubException> onError;
  private final Logger logger;
  private final HttpClient http;
  private final long retryBaseMillis;
  private final Object lock = new Object();
  private final Object sendLock = new Object();
  private final Deque<Object[]> queue = new ArrayDeque<>();
  private int dropped;
  private final ScheduledExecutorService executor;
  private final Thread shutdownHook;
  private volatile boolean closed;

  private TapCub(Builder b) {
    if (b.apiKey == null || b.apiKey.trim().isEmpty()) throw new IllegalArgumentException("TapCub: apiKey is required");
    if (b.mode == null) throw new IllegalArgumentException("TapCub: mode is required");
    this.apiKey = b.apiKey.trim();
    this.endpoint = normalizeEndpoint(b.endpoint);
    this.mode = b.mode;
    this.maxBatch = Math.max(1, Math.min(1000, b.maxBatch));
    this.maxQueueSize = Math.max(1, b.maxQueueSize);
    this.maxRetries = Math.max(0, b.maxRetries);
    this.timeout = b.timeout == null ? Duration.ofSeconds(10) : b.timeout;
    this.gzip = b.gzip;
    this.logger = b.logger == null ? LOG : b.logger;
    this.onError = b.onError != null ? b.onError : e -> this.logger.log(Level.WARNING, "[tapcub] " + e.getMessage());
    this.http = b.httpClient != null ? b.httpClient : HttpClient.newBuilder().connectTimeout(this.timeout).build();
    this.retryBaseMillis = b.retryBaseMillis;
    if (mode == Mode.BATCH) {
      executor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "tapcub-sender");
        t.setDaemon(true);
        return t;
      });
      long every = Math.max(10, (b.flushInterval == null ? Duration.ofSeconds(3) : b.flushInterval).toMillis());
      executor.scheduleWithFixedDelay(this::backgroundFlush, every, every, TimeUnit.MILLISECONDS);
      if (b.flushOnShutdown) {
        shutdownHook = new Thread(this::closeQuietly, "tapcub-shutdown");
        Runtime.getRuntime().addShutdownHook(shutdownHook);
      } else {
        shutdownHook = null;
      }
    } else {
      executor = null;
      shutdownHook = null;
    }
  }

  /** Origin (plus any reverse-proxy prefix) without {@code /api/v1/track}. */
  public static String normalizeEndpoint(String endpoint) {
    String e = endpoint == null || endpoint.trim().isEmpty() ? DEFAULT_ENDPOINT : endpoint.trim();
    e = e.replaceAll("/+$", "").replaceAll("/api/v1(/track)?$", "");
    if (!e.startsWith("http://") && !e.startsWith("https://")) throw new IllegalArgumentException("TapCub: endpoint must start with http:// or https://");
    return e;
  }

  /**
   * Device and session IDs a TapCub client put on a request to your backend ({@code X-Tc-Device} /
   * {@code X-Tc-Session}). Pass a header getter, for example {@code request::getHeader}.
   *
   * @return {@code [deviceId, sessionId]}, null where missing
   */
  public static String[] fromRequestHeaders(Function<String, String> header) {
    String d = header.apply("X-Tc-Device");
    String s = header.apply("X-Tc-Session");
    return new String[] {d == null || d.trim().isEmpty() ? null : d.trim(), s == null || s.trim().isEmpty() ? null : s.trim()};
  }

  // ---------------- events ----------------

  public void track(String event) {
    track(event, null);
  }

  /** A business event. */
  public void track(String event, TrackOptions o) {
    TrackOptions t = o == null ? new TrackOptions() : o;
    String type = Normalizer.loginIdType(t.loginIdType);
    String login = Normalizer.optionalText("loginId", t.loginId, 200);
    if (login != null && ("email".equals(type) || "mobile".equals(type))) login = Normalizer.identityValue(type, login);
    Map<String, Object> ev = new LinkedHashMap<>();
    ev.put("type", "track");
    ev.put("event", Normalizer.eventName(event));
    ev.put("login_id", login);
    ev.put("login_id_type", type);
    ev.put("device_id", Normalizer.optionalText("deviceId", t.deviceId, 72));
    ev.put("session_id", Normalizer.optionalText("sessionId", t.sessionId, 32));
    ev.put("insert_id", Normalizer.optionalText("insertId", t.insertId, 36));
    ev.put("time", t.time != null ? t.time : System.currentTimeMillis());
    ev.put("group", Normalizer.group(t.group));
    ev.put("properties", Normalizer.properties(t.properties));
    ev.put("context", Normalizer.context(t.context));
    enqueue(ev);
  }

  public void trackSignup(String loginId) {
    trackSignup(loginId, null);
  }

  /** Sign-up: links the anonymous device (if any) to the new login ID and records {@code sign_up}. */
  public void trackSignup(String loginId, SignupOptions o) {
    SignupOptions s = o == null ? new SignupOptions() : o;
    Map<String, Object> props = s.properties == null ? new LinkedHashMap<>() : new LinkedHashMap<>(s.properties);
    if (s.invitedBy != null && !s.invitedBy.trim().isEmpty()) props.put("$invited_by", s.invitedBy.trim());
    Map<String, Object> ev = new LinkedHashMap<>();
    ev.put("type", "track_signup");
    ev.put("event", "sign_up");
    ev.put("login_id", Normalizer.requireText("loginId", loginId, 200));
    ev.put("device_id", Normalizer.optionalText("deviceId", s.deviceId, 72));
    ev.put("session_id", Normalizer.optionalText("sessionId", s.sessionId, 32));
    ev.put("insert_id", Normalizer.optionalText("insertId", s.insertId, 36));
    ev.put("time", s.time != null ? s.time : System.currentTimeMillis());
    ev.put("properties", Normalizer.properties(props));
    ev.put("context", Normalizer.context(s.context));
    enqueue(ev);
  }

  /** Merge properties into the stored event with this insert ID. */
  public void trackUpdate(String event, String insertId, Map<String, ?> properties) {
    correct("track_update", event, insertId, properties);
  }

  /** Replace the properties of the stored event with this insert ID. */
  public void trackOverwrite(String event, String insertId, Map<String, ?> properties) {
    correct("track_overwrite", event, insertId, properties);
  }

  private void correct(String type, String event, String insertId, Map<String, ?> properties) {
    Map<String, Object> ev = base(type);
    ev.put("event", Normalizer.eventName(event));
    ev.put("insert_id", Normalizer.requireText("insertId", insertId, 36));
    ev.put("properties", Normalizer.properties(properties));
    enqueue(ev);
  }

  // ---------------- identity ----------------

  /** Attach more identities (email, mobile, unionid, openid, custom). Email and mobile are SHA-256 hashed first. */
  public void bind(String loginId, Map<String, String> identities) {
    Map<String, Object> ev = withLogin("bind", loginId);
    ev.put("identities", Normalizer.identities(identities));
    enqueue(ev);
  }

  /** Remove one identity from the user. */
  public void unbind(String loginId, String identityType, String value) {
    Map<String, Object> ev = withLogin("unbind", loginId);
    Map<String, String> one = new LinkedHashMap<>();
    one.put(identityType, Normalizer.requireText("value", value, 0));
    ev.put("identities", Normalizer.identities(one));
    enqueue(ev);
  }

  // ---------------- profiles ----------------

  public void profileSet(String loginId, Map<String, ?> properties) {
    profile("profile_set", loginId, "properties", Normalizer.properties(properties));
  }

  /** Set only the properties that are not set yet. */
  public void profileSetOnce(String loginId, Map<String, ?> properties) {
    profile("profile_set_once", loginId, "properties", Normalizer.properties(properties));
  }

  /** Add to numeric profile properties; non-numbers are ignored. */
  public void profileIncrement(String loginId, Map<String, ?> increment) {
    profile("profile_increment", loginId, "increment", Normalizer.increment(increment));
  }

  /** Append a value or a collection of strings / numbers / booleans to list properties. */
  public void profileAppend(String loginId, Map<String, ?> append) {
    profile("profile_append", loginId, "append", Normalizer.append(append));
  }

  public void profileUnset(String loginId, Collection<String> keys) {
    profile("profile_unset", loginId, "unset", Normalizer.unsetKeys(keys));
  }

  private void profile(String type, String loginId, String field, Object value) {
    Map<String, Object> ev = withLogin(type, loginId);
    ev.put(field, value);
    enqueue(ev);
  }

  // ---------------- items / accounts ----------------

  /** Upsert a dimension row (product, article, store …). */
  public void itemSet(String itemType, String itemId, Map<String, ?> properties) {
    Map<String, Object> ev = item("item_set", itemType, itemId);
    ev.put("properties", Normalizer.properties(properties));
    enqueue(ev);
  }

  public void itemDelete(String itemType, String itemId) {
    enqueue(item("item_delete", itemType, itemId));
  }

  /** Set account (group) traits for {@code groupType:groupId}. */
  public void groupSet(String groupType, String groupId, Map<String, ?> properties) {
    Map<String, Object> ev = new LinkedHashMap<>();
    ev.put("type", "group_set");
    ev.put("group", Normalizer.groupKey(groupType, groupId));
    ev.put("time", System.currentTimeMillis());
    ev.put("properties", Normalizer.properties(properties));
    enqueue(ev);
  }

  private static Map<String, Object> base(String type) {
    Map<String, Object> ev = new LinkedHashMap<>();
    ev.put("type", type);
    ev.put("time", System.currentTimeMillis());
    return ev;
  }

  private static Map<String, Object> withLogin(String type, String loginId) {
    Map<String, Object> ev = new LinkedHashMap<>();
    ev.put("type", type);
    ev.put("login_id", Normalizer.requireText("loginId", loginId, 200));
    ev.put("time", System.currentTimeMillis());
    return ev;
  }

  private static Map<String, Object> item(String type, String itemType, String itemId) {
    Map<String, Object> ev = new LinkedHashMap<>();
    ev.put("type", type);
    ev.put("item_type", Normalizer.requireText("itemType", itemType, 40));
    ev.put("item_id", Normalizer.requireText("itemId", itemId, 80));
    ev.put("time", System.currentTimeMillis());
    return ev;
  }

  // ---------------- sending ----------------

  /** Send everything queued now. Throws the first {@link TapCubException} if a batch could not be delivered. */
  public void flush() {
    List<TapCubException> errors = drain();
    if (!errors.isEmpty()) throw errors.get(0);
  }

  /** Stop the background thread and send what is queued (throws like {@link #flush()}). */
  @Override
  public void close() {
    closed = true;
    if (executor != null) {
      executor.shutdown();
      try {
        executor.awaitTermination(timeout.toMillis() * (maxRetries + 1) + 5000, TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
    if (shutdownHook != null && Thread.currentThread() != shutdownHook) {
      try {
        Runtime.getRuntime().removeShutdownHook(shutdownHook);
      } catch (IllegalStateException ignored) {
        // JVM 正在关闭
      }
    }
    flush();
  }

  /** Number of events waiting in the queue. */
  public int queued() {
    synchronized (lock) {
      return queue.size();
    }
  }

  private void closeQuietly() {
    try {
      close();
    } catch (TapCubException e) {
      report(e);
    }
  }

  private void enqueue(Map<String, Object> raw) {
    Map<String, Object> ev = Normalizer.compact(raw);
    if (mode != Mode.BATCH) {
      send(singleton(ev), mode == Mode.DEBUG);
      return;
    }
    if (closed) logger.warning("[tapcub] event queued after close(); call flush() to send it");
    int bytes = Json.write(ev).getBytes(StandardCharsets.UTF_8).length + 1;
    boolean full;
    synchronized (lock) {
      queue.addLast(new Object[] {ev, bytes});
      while (queue.size() > maxQueueSize) {
        queue.removeFirst();
        dropped++;
      }
      full = queue.size() >= maxBatch;
    }
    if (full && !executor.isShutdown()) {
      try {
        executor.execute(this::backgroundFlush);
      } catch (java.util.concurrent.RejectedExecutionException ignored) {
        // 正在关闭：close() 会发送
      }
    }
  }

  private static List<Map<String, Object>> singleton(Map<String, Object> ev) {
    List<Map<String, Object>> l = new ArrayList<>(1);
    l.add(ev);
    return l;
  }

  private void backgroundFlush() {
    for (TapCubException e : drain()) report(e);
  }

  private void report(TapCubException e) {
    try {
      onError.accept(e);
    } catch (RuntimeException t) {
      logger.log(Level.WARNING, "[tapcub] onError threw", t);
    }
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> take() {
    synchronized (lock) {
      List<Map<String, Object>> batch = new ArrayList<>();
      int size = 0;
      while (!queue.isEmpty() && batch.size() < maxBatch) {
        Object[] q = queue.peekFirst();
        int b = (Integer) q[1];
        if (!batch.isEmpty() && size + b > MAX_BODY_BYTES) break;
        queue.removeFirst();
        batch.add((Map<String, Object>) q[0]);
        size += b;
      }
      return batch;
    }
  }

  private List<TapCubException> drain() {
    List<TapCubException> errors = new ArrayList<>();
    synchronized (sendLock) {
      int d;
      synchronized (lock) {
        d = dropped;
        dropped = 0;
      }
      if (d > 0) errors.add(new TapCubException("TapCub: queue full, dropped " + d + " oldest event(s)", "QUEUE_FULL", 0, null, null, null));
      while (true) {
        List<Map<String, Object>> batch = take();
        if (batch.isEmpty()) break;
        try {
          send(batch, false);
        } catch (TapCubException e) {
          errors.add(e);
        }
      }
    }
    return errors;
  }

  private static byte[] gzipBytes(byte[] in) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try (GZIPOutputStream z = new GZIPOutputStream(out)) {
      z.write(in);
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
    return out.toByteArray();
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> send(List<Map<String, Object>> events, boolean debug) {
    String url = endpoint + "/api/v1/track" + (debug ? "?debug=1" : "");
    Map<String, Object> wrapper = new LinkedHashMap<>();
    wrapper.put("events", events);
    byte[] body = Json.write(wrapper).getBytes(StandardCharsets.UTF_8);
    if (gzip) body = gzipBytes(body);
    TapCubException last = null;
    for (int attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        try {
          Thread.sleep(backoff(attempt, last));
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          break;
        }
      }
      HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(url))
          .timeout(timeout)
          .header("Content-Type", "application/json")
          .header("Authorization", "Bearer " + apiKey)
          .header("User-Agent", "tapcub-java/" + VERSION)
          .POST(HttpRequest.BodyPublishers.ofByteArray(body));
      if (gzip) rb.header("Content-Encoding", "gzip");
      HttpResponse<String> res;
      try {
        res = http.send(rb.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      } catch (IOException e) {
        last = new TapCubException("TapCub: request failed: " + e, "NETWORK", 0, events, null, e);
        continue;
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        last = new TapCubException("TapCub: interrupted", "NETWORK", 0, events, null, e);
        break;
      }
      Map<String, Object> data;
      try {
        Object parsed = res.body() == null || res.body().isEmpty() ? null : Json.parse(res.body());
        data = parsed instanceof Map ? (Map<String, Object>) parsed : new LinkedHashMap<>();
      } catch (IllegalArgumentException e) {
        data = new LinkedHashMap<>();
      }
      int status = res.statusCode();
      if (status >= 200 && status < 300) {
        List<Map<String, Object>> results = data.get("results") instanceof List ? (List<Map<String, Object>>) data.get("results") : new ArrayList<>();
        List<Map<String, Object>> bad = new ArrayList<>();
        List<Map<String, Object>> rejected = new ArrayList<>();
        StringBuilder desc = new StringBuilder();
        for (Map<String, Object> r : results) {
          boolean ok = Boolean.TRUE.equals(r.get("ok"));
          List<Object> w = r.get("warnings") instanceof List ? (List<Object>) r.get("warnings") : new ArrayList<>();
          String warnings = String.join(",", w.stream().map(String::valueOf).toArray(String[]::new));
          if (debug) logger.warning("[tapcub] debug #" + r.get("index") + " " + (ok ? "ok" : "rejected") + (warnings.isEmpty() ? "" : " warnings=" + warnings));
          if (ok) continue;
          bad.add(r);
          Object idx = r.get("index");
          if (idx instanceof Number && ((Number) idx).intValue() >= 0 && ((Number) idx).intValue() < events.size()) rejected.add(events.get(((Number) idx).intValue()));
          if (desc.length() > 0) desc.append("; ");
          desc.append('#').append(idx).append(' ').append(warnings.isEmpty() ? "rejected" : warnings);
        }
        if (!bad.isEmpty()) throw new TapCubException("TapCub: " + bad.size() + " event(s) rejected: " + desc, "EVENT_REJECTED", status, rejected, bad, null);
        data.put("results", results);
        return data;
      }
      String code = data.get("code") instanceof String ? (String) data.get("code") : "HTTP_" + status;
      String msg = data.get("message") instanceof String ? (String) data.get("message") : (res.body() == null ? "" : res.body().substring(0, Math.min(200, res.body().length())));
      if (data.get("issues") instanceof List && !((List<?>) data.get("issues")).isEmpty()) {
        List<?> issues = (List<?>) data.get("issues");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(3, issues.size()); i++) sb.append(i > 0 ? "; " : "").append(issues.get(i));
        msg += " (" + sb + ")";
      }
      last = new TapCubException("TapCub: HTTP " + status + " " + code + ": " + msg, code, status, events, null, null);
      try {
        last.retryAfterSeconds = Double.parseDouble(res.headers().firstValue("retry-after").orElse("0"));
      } catch (NumberFormatException ignored) {
        last.retryAfterSeconds = 0;
      }
      if (status != 429 && status < 500) throw last;
    }
    throw last;
  }

  private long backoff(int attempt, TapCubException last) {
    if (last != null && last.retryAfterSeconds > 0) return (long) (Math.min(60, last.retryAfterSeconds) * 1000);
    long base = Math.min(30_000, retryBaseMillis * (1L << Math.min(20, attempt - 1)));
    return base / 2 + ThreadLocalRandom.current().nextLong(base / 2 + 1);
  }
}
