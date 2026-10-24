package com.tapcub.server.examples;

import com.tapcub.server.Campaign;
import com.tapcub.server.SignupOptions;
import com.tapcub.server.TapCub;
import com.tapcub.server.TapCubException;
import com.tapcub.server.TrackOptions;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * End-to-end scenario against a running TapCub API. Used by scripts/smoke-sdk-server.mjs in the main repository.
 *
 * <pre>TAPCUB_API_KEY=wck_… TAPCUB_ENDPOINT=http://localhost:3001 TAPCUB_RUN=abc \
 *   mvn -q test-compile exec:java -Dexec.mainClass=com.tapcub.server.examples.E2E -Dexec.classpathScope=test</pre>
 */
public final class E2E {
  public static void main(String[] args) {
    String lang = "java";
    String run = System.getenv().getOrDefault("TAPCUB_RUN", Long.toString(System.currentTimeMillis(), 36));
    String key = System.getenv("TAPCUB_API_KEY");
    String endpoint = System.getenv("TAPCUB_ENDPOINT");
    String user = lang + "-" + run;
    Logger quiet = Logger.getAnonymousLogger();
    quiet.setLevel(Level.SEVERE);

    // 1. Validate one event without storing it
    TapCub.builder(key).endpoint(endpoint).mode(TapCub.Mode.DEBUG).logger(quiet).build().track("sdk_e2e_debug", new TrackOptions().loginId(user));

    // 2. Batch client: everything below goes out in one request on close()
    List<TapCubException> errors = new CopyOnWriteArrayList<>();
    try (TapCub tc = TapCub.builder(key).endpoint(endpoint).onError(errors::add).build()) {
      tc.trackSignup(user, new SignupOptions().deviceId("custom:" + lang + run + "dev").invitedBy("e2e-inviter").campaign(new Campaign().source("e2e").medium("sdk").name(lang)));
      tc.track("sdk_e2e_purchase", new TrackOptions()
          .loginId(user)
          .insertId(user + "-o1")
          .property("revenue", 19.9)
          .property("currency", "USD")
          .property("items", List.of(Map.of("item_id", "sku-" + lang, "price", 19.9, "quantity", 1)))
          .ip("203.0.113.7")
          .userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")
          .url("https://shop.example.com/checkout"));
      tc.bind(user, Map.of("email", user + "@example.com"));
      tc.profileSet(user, Map.of("plan", "pro", "$name", "E2E " + lang));
      tc.profileSetOnce(user, Map.of("first_source", "e2e"));
      tc.profileIncrement(user, Map.of("orders", 1));
      tc.profileAppend(user, Map.of("tags", List.of("e2e")));
      tc.itemSet("product", "sku-" + lang, Map.of("name", "Shoe", "price", 19.9));
      tc.groupSet("company", "acme-" + lang, Map.of("name", "Acme"));
      tc.track("sdk_e2e_seat", new TrackOptions().loginId(user).group("company:acme-" + lang));
    } catch (TapCubException e) {
      errors.add(e);
    }
    if (!errors.isEmpty()) {
      errors.forEach(e -> System.err.println(e.getMessage()));
      System.exit(1);
    }
    System.out.println("{\"ok\":true,\"lang\":\"" + lang + "\",\"user\":\"" + user + "\"}");
  }
}
