package com.tapcub.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tapcub.server.internal.Json;
import java.io.IOException;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Shared conformance vectors: test-vectors/track (rules in that directory's README). */
class VectorsTest {
  static Path vectorDir() {
    for (String d : new String[] {System.getenv("TAPCUB_VECTORS"), System.getProperty("tapcub.vectorDir"), "../../shared/test-vectors/track"}) {
      if (d != null && Files.isDirectory(Paths.get(d))) return Paths.get(d);
    }
    throw new IllegalStateException("shared vectors not found (set TAPCUB_VECTORS)");
  }

  static List<Path> files() throws IOException {
    try (Stream<Path> s = Files.list(vectorDir())) {
      return s.filter(p -> p.toString().endsWith(".json")).sorted().collect(Collectors.toList());
    }
  }

  @Test
  void vectorSetIsComplete() throws IOException {
    assertTrue(files().size() >= 30, files().size() + " vectors");
  }

  @Test
  void versionMatchesPom() {
    String pom = System.getProperty("tapcub.pomVersion");
    if (pom != null) assertEquals(pom, TapCub.VERSION);
  }

  static String s(Map<String, Object> a, String k) {
    Object v = a.get(k);
    return v == null ? null : v.toString();
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> m(Map<String, Object> a, String k) {
    return (Map<String, Object>) a.get(k);
  }

  @SuppressWarnings("unchecked")
  static void call(TapCub tc, String method, Map<String, Object> a) {
    switch (method) {
      case "track": {
        TrackOptions o = new TrackOptions().loginId(s(a, "login_id")).loginIdType(s(a, "login_id_type")).deviceId(s(a, "device_id"))
            .sessionId(s(a, "session_id")).insertId(s(a, "insert_id")).group(s(a, "group")).properties(m(a, "properties")).context(m(a, "context"));
        if (a.get("time") instanceof Number) o.time(((Number) a.get("time")).longValue());
        tc.track(s(a, "event"), o);
        return;
      }
      case "track_signup": {
        SignupOptions o = new SignupOptions().deviceId(s(a, "device_id")).sessionId(s(a, "session_id")).insertId(s(a, "insert_id"))
            .properties(m(a, "properties")).invitedBy(s(a, "invited_by")).context(m(a, "context"));
        if (a.get("time") instanceof Number) o.time(((Number) a.get("time")).longValue());
        tc.trackSignup(s(a, "login_id"), o);
        return;
      }
      case "bind":
        tc.bind(s(a, "login_id"), (Map<String, String>) (Map<String, ?>) m(a, "identities"));
        return;
      case "unbind":
        tc.unbind(s(a, "login_id"), s(a, "identity_type"), s(a, "value"));
        return;
      case "profile_set":
        tc.profileSet(s(a, "login_id"), m(a, "properties"));
        return;
      case "profile_set_once":
        tc.profileSetOnce(s(a, "login_id"), m(a, "properties"));
        return;
      case "profile_increment":
        tc.profileIncrement(s(a, "login_id"), m(a, "increment"));
        return;
      case "profile_append":
        tc.profileAppend(s(a, "login_id"), m(a, "append"));
        return;
      case "profile_unset":
        tc.profileUnset(s(a, "login_id"), (List<String>) a.get("keys"));
        return;
      case "item_set":
        tc.itemSet(s(a, "item_type"), s(a, "item_id"), m(a, "properties"));
        return;
      case "item_delete":
        tc.itemDelete(s(a, "item_type"), s(a, "item_id"));
        return;
      case "track_update":
        tc.trackUpdate(s(a, "event"), s(a, "insert_id"), m(a, "properties"));
        return;
      case "track_overwrite":
        tc.trackOverwrite(s(a, "event"), s(a, "insert_id"), m(a, "properties"));
        return;
      case "group_set":
        tc.groupSet(s(a, "group_type"), s(a, "group_id"), m(a, "properties"));
        return;
      default:
        throw new AssertionError("unknown method " + method);
    }
  }

  @TestFactory
  @SuppressWarnings("unchecked")
  List<DynamicTest> vectors() throws IOException {
    List<DynamicTest> tests = new ArrayList<>();
    for (Path f : files()) {
      tests.add(DynamicTest.dynamicTest(f.getFileName().toString(), () -> {
        Map<String, Object> v = (Map<String, Object>) Json.parse(new String(Files.readAllBytes(f), StandardCharsets.UTF_8));
        Map<String, Object> c = (Map<String, Object>) v.get("call");
        TransportTest.Mock mock = new TransportTest.Mock();
        try {
          TapCub tc = TapCub.builder("wck_test").endpoint(mock.url()).mode(TapCub.Mode.SYNC).httpClient(HttpClient.newHttpClient()).build();
          if (Boolean.TRUE.equals(v.get("error"))) {
            assertThrows(IllegalArgumentException.class, () -> call(tc, (String) c.get("method"), (Map<String, Object>) c.get("args")));
            assertEquals(0, mock.requests().size());
            return;
          }
          call(tc, (String) c.get("method"), (Map<String, Object>) c.get("args"));
          assertEquals(1, mock.requests().size());
          Map<String, Object> ev = ((List<Map<String, Object>>) mock.requests().get(0).body.get("events")).get(0);
          Map<String, Object> expected = (Map<String, Object>) v.get("expected");
          if ("$now".equals(expected.get("time"))) {
            long t = ((Number) ev.get("time")).longValue();
            assertTrue(Math.abs(t - System.currentTimeMillis()) < 60_000, "time " + t);
            expected.put("time", ev.get("time"));
          }
          assertEquals(Json.parse(Json.write(expected)), Json.parse(Json.write(ev)));
        } finally {
          mock.close();
        }
      }));
    }
    return tests;
  }
}
