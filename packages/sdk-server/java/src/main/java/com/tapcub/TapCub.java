package com.tapcub;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class TapCub {
  private final String apiKey;
  private final String endpoint;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();

  public TapCub(String apiKey, String endpoint) {
    this.apiKey = apiKey;
    this.endpoint = endpoint.replaceAll("/$", "");
  }

  public String track(String event, String jsonProps) throws Exception {
    String body = "{\"events\":[{\"type\":\"track\",\"event\":\"" + event + "\",\"properties\":" + (jsonProps == null ? "{}" : jsonProps) + ",\"context\":{\"platform\":\"server\",\"library\":{\"name\":\"tapcub-java\",\"version\":\"0.1.0\"}}}]}";
    HttpRequest req = HttpRequest.newBuilder()
      .uri(URI.create(endpoint + "/api/v1/track"))
      .header("Content-Type", "application/json")
      .header("Authorization", "Bearer " + apiKey)
      .POST(HttpRequest.BodyPublishers.ofString(body))
      .build();
    return http.send(req, HttpResponse.BodyHandlers.ofString()).body();
  }
}
