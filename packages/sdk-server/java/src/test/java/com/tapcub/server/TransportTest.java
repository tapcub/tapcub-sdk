package com.tapcub.server;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import com.tapcub.server.internal.Json;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiFunction;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import java.util.stream.Collectors;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;

/** Transport behaviour against the JDK HTTP server: batching, splitting, retries, gzip, error handling, debug. */
class TransportTest {
  static final class Req {
    String uri;
    Map<String, String> headers = new HashMap<>();
    byte[] raw;
    Map<String, Object> body;
  }

  /** handler: (request number, request) → [status, body, retry-after or null] */
  static final class Mock implements AutoCloseable {
    final HttpServer server;
    final List<Req> reqs = new CopyOnWriteArrayList<>();

    Mock() throws IOException {
      this((n, r) -> new Object[] {200, "{\"received\":1,\"accepted\":1,\"rejected\":0,\"events\":1,\"results\":[]}", null});
    }

    @SuppressWarnings("unchecked")
    Mock(BiFunction<Integer, Req, Object[]> handler) throws IOException {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/", ex -> {
        Req r = new Req();
        r.uri = ex.getRequestURI().toString();
        ex.getRequestHeaders().forEach((k, v) -> r.headers.put(k.toLowerCase(), v.get(0)));
        InputStream in = ex.getRequestBody();
        if ("gzip".equals(r.headers.get("content-encoding"))) in = new GZIPInputStream(in);
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        in.transferTo(buf);
        r.raw = buf.toByteArray();
        r.body = (Map<String, Object>) Json.parse(new String(r.raw, StandardCharsets.UTF_8));
        reqs.add(r);
        Object[] res = handler.apply(reqs.size(), r);
        byte[] out = ((String) res[1]).getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        if (res[2] != null) ex.getResponseHeaders().set("Retry-After", (String) res[2]);
        ex.sendResponseHeaders((Integer) res[0], out.length);
        try (OutputStream os = ex.getResponseBody()) {
          os.write(out);
        }
      });
      server.start();
    }

    String url() {
      return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    List<Req> requests() {
      return new ArrayList<>(reqs);
    }

    @Override
    public void close() {
      server.stop(0);
    }
  }

  @SuppressWarnings("unchecked")
  static List<String> events(Req r) {
    return ((List<Map<String, Object>>) r.body.get("events")).stream().map(e -> (String) e.get("event")).collect(Collectors.toList());
  }

  static TapCub.Builder client(Mock m) {
    return TapCub.builder("wck_abc").endpoint(m.url()).retryBaseMillis(5).flushOnShutdown(false);
  }

  @Test
  void endpointNormalization() {
    assertEquals("https://api.pathclue.com", TapCub.normalizeEndpoint(null));
    assertEquals("https://api.pathclue.com", TapCub.normalizeEndpoint("https://api.pathclue.com/"));
    assertEquals("https://x.example.com", TapCub.normalizeEndpoint("https://x.example.com/api/v1/track"));
    assertEquals("https://x.example.com/proxy", TapCub.normalizeEndpoint("https://x.example.com/proxy/api/v1"));
    assertThrows(IllegalArgumentException.class, () -> TapCub.normalizeEndpoint("api.pathclue.com"));
    assertThrows(IllegalArgumentException.class, () -> TapCub.builder(" ").build());
  }

  @Test
  void headersAndPath() throws IOException {
    try (Mock m = new Mock()) {
      client(m).mode(TapCub.Mode.SYNC).build().track("purchase", new TrackOptions().insertId("o1"));
      Req r = m.requests().get(0);
      assertEquals("/api/v1/track", r.uri);
      assertEquals("Bearer wck_abc", r.headers.get("authorization"));
      assertEquals("application/json", r.headers.get("content-type"));
      assertEquals("tapcub-java/" + TapCub.VERSION, r.headers.get("user-agent"));
      assertEquals(Collections.singleton("events"), r.body.keySet());
    }
  }

  @Test
  void batchSplitAndClose() throws IOException {
    try (Mock m = new Mock()) {
      TapCub tc = client(m).maxBatch(2).flushInterval(Duration.ofMinutes(1)).build();
      tc.track("a");
      assertEquals(0, m.requests().size());
      assertEquals(1, tc.queued());
      tc.track("b");
      tc.track("c");
      tc.close();
      List<String> all = new ArrayList<>();
      for (Req r : m.requests()) {
        assertTrue(events(r).size() <= 2);
        all.addAll(events(r));
      }
      assertEquals(List.of("a", "b", "c"), all);
    }
  }

  @Test
  void flushOnInterval() throws Exception {
    try (Mock m = new Mock()) {
      TapCub tc = client(m).flushInterval(Duration.ofMillis(30)).build();
      tc.track("a");
      Thread.sleep(300);
      assertEquals(1, m.requests().size());
      tc.close();
    }
  }

  @Test
  void bodySplitAt1MB() throws IOException {
    try (Mock m = new Mock()) {
      TapCub tc = client(m).maxBatch(1000).flushInterval(Duration.ofMinutes(1)).build();
      Map<String, Object> big = new LinkedHashMap<>();
      for (int i = 0; i < 40; i++) big.put("p" + i, "x".repeat(1000));
      for (int i = 0; i < 50; i++) tc.track("big", new TrackOptions().properties(big));
      tc.flush();
      int total = 0;
      for (Req r : m.requests()) {
        assertTrue(r.raw.length <= 1_000_000);
        total += events(r).size();
      }
      assertTrue(m.requests().size() >= 2);
      assertEquals(50, total);
      tc.close();
    }
  }

  @Test
  void retriesWithSameBody() throws IOException {
    try (Mock m = new Mock((n, r) -> n == 1 ? new Object[] {503, "{\"message\":\"down\"}", null} : n == 2 ? new Object[] {429, "{\"message\":\"slow\"}", "0"} : new Object[] {200, "{\"results\":[]}", null})) {
      client(m).mode(TapCub.Mode.SYNC).build().track("a", new TrackOptions().insertId("same"));
      List<Req> r = m.requests();
      assertEquals(3, r.size());
      assertArrayEquals(r.get(0).raw, r.get(2).raw);
    }
  }

  @Test
  void clientErrorNotRetried() throws IOException {
    try (Mock m = new Mock((n, r) -> new Object[] {401, "{\"statusCode\":401,\"message\":\"bad key\",\"code\":\"BAD_API_KEY\"}", null})) {
      TapCubException e = assertThrows(TapCubException.class, () -> client(m).mode(TapCub.Mode.SYNC).build().track("a"));
      assertEquals("BAD_API_KEY", e.getCode());
      assertEquals(401, e.getStatus());
      assertEquals(1, e.getEvents().size());
      assertEquals(1, m.requests().size());
    }
  }

  @Test
  void backgroundErrorsGoToOnErrorAndFlushThrows() throws Exception {
    try (Mock m = new Mock((n, r) -> new Object[] {500, "{\"message\":\"boom\"}", null})) {
      List<TapCubException> errors = new CopyOnWriteArrayList<>();
      TapCub tc = client(m).maxRetries(2).maxBatch(1).flushInterval(Duration.ofMinutes(1)).onError(errors::add).build();
      tc.track("a");
      for (int i = 0; i < 100 && errors.isEmpty(); i++) Thread.sleep(20);
      assertEquals(3, m.requests().size());
      assertEquals(1, errors.size());
      assertEquals("HTTP_500", errors.get(0).getCode());
      tc.close();
      TapCub tc2 = client(m).maxRetries(1).flushInterval(Duration.ofMinutes(1)).onError(errors::add).build();
      tc2.track("b");
      TapCubException e = assertThrows(TapCubException.class, tc2::close);
      assertEquals("b", e.getEvents().get(0).get("event"));
      assertEquals(1, errors.size());
    }
  }

  @Test
  void networkError() {
    TapCub tc = TapCub.builder("k").endpoint("http://127.0.0.1:9").mode(TapCub.Mode.SYNC).maxRetries(1).retryBaseMillis(5).timeout(Duration.ofSeconds(2)).build();
    assertEquals("NETWORK", assertThrows(TapCubException.class, () -> tc.track("a")).getCode());
  }

  @Test
  void eventRejectedIn2xx() throws IOException {
    try (Mock m = new Mock((n, r) -> new Object[] {200, "{\"received\":2,\"accepted\":1,\"rejected\":1,\"results\":[{\"index\":1,\"ok\":false,\"warnings\":[\"profile_without_person\"]}]}", null})) {
      TapCub tc = client(m).flushInterval(Duration.ofMinutes(1)).build();
      tc.track("a");
      tc.profileSet("u", Map.of("a", 1));
      TapCubException e = assertThrows(TapCubException.class, tc::flush);
      assertEquals("EVENT_REJECTED", e.getCode());
      assertEquals(1, e.getEvents().size());
      assertEquals("profile_set", e.getEvents().get(0).get("type"));
      tc.close();
    }
  }

  @Test
  void queueOverflowDropsOldest() throws IOException {
    try (Mock m = new Mock()) {
      TapCub tc = client(m).maxQueueSize(3).maxBatch(1000).flushInterval(Duration.ofMinutes(1)).build();
      for (String e : List.of("a", "b", "c", "d", "e")) tc.track(e);
      assertEquals("QUEUE_FULL", assertThrows(TapCubException.class, tc::flush).getCode());
      assertEquals(List.of("c", "d", "e"), events(m.requests().get(0)));
      tc.close();
    }
  }

  @Test
  void gzip() throws IOException {
    try (Mock m = new Mock()) {
      client(m).mode(TapCub.Mode.SYNC).gzip(true).build().track("a");
      Req r = m.requests().get(0);
      assertEquals("gzip", r.headers.get("content-encoding"));
      assertEquals(List.of("a"), events(r));
    }
  }

  @Test
  void debugMode() throws IOException {
    try (Mock m = new Mock((n, r) -> new Object[] {200, "{\"debug\":true,\"results\":[{\"index\":0,\"ok\":true,\"warnings\":[\"plaintext_identity_hashed\"]}]}", null})) {
      Logger lg = Logger.getAnonymousLogger();
      lg.setUseParentHandlers(false);
      List<String> logs = new CopyOnWriteArrayList<>();
      lg.addHandler(new Handler() {
        @Override
        public void publish(LogRecord record) {
          logs.add(record.getMessage());
        }

        @Override
        public void flush() {}

        @Override
        public void close() {}
      });
      client(m).mode(TapCub.Mode.DEBUG).logger(lg).build().track("a");
      assertEquals("/api/v1/track?debug=1", m.requests().get(0).uri);
      assertTrue(logs.get(0).contains("#0 ok warnings=plaintext_identity_hashed"), logs.toString());
    }
  }

  @Test
  @SuppressWarnings("unchecked")
  void typedPropertiesAndTime() throws IOException {
    try (Mock m = new Mock()) {
      java.time.Instant when = java.time.Instant.parse("2026-10-01T12:00:00Z");
      Map<String, Object> p = new LinkedHashMap<>();
      p.put("at", when);
      p.put("d", 99.0);
      p.put("tags", List.of("a", "b"));
      p.put("items", List.of(Map.of("item_id", "s1")));
      client(m).mode(TapCub.Mode.SYNC).build().track("a", new TrackOptions().time(when).properties(p).campaign(new Campaign().source("google").touchedAt(1L)));
      Map<String, Object> ev = ((List<Map<String, Object>>) m.requests().get(0).body.get("events")).get(0);
      assertEquals(when.toEpochMilli(), ((Number) ev.get("time")).longValue());
      Map<String, Object> props = (Map<String, Object>) ev.get("properties");
      assertEquals("2026-10-01T12:00:00Z", props.get("at"));
      assertEquals(99L, props.get("d"));
      assertEquals("[\"a\",\"b\"]", props.get("tags"));
      assertEquals(List.of(Map.of("item_id", "s1")), props.get("items"));
      assertEquals(Map.of("campaign", Map.of("source", "google", "touched_at", 1L)), ev.get("context"));
    }
  }

  @Test
  void fromRequestHeaders() {
    Map<String, String> h = Map.of("X-Tc-Device", "custom:abcd1234", "X-Tc-Session", " s1 ");
    assertArrayEquals(new String[] {"custom:abcd1234", "s1"}, TapCub.fromRequestHeaders(h::get));
  }
}
