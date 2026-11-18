package local.workbench.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "workbench.bridge-token=fictional-bridge-token-at-least-32-characters")
@AutoConfigureMockMvc
class WorkerContractTest {
  static final String TOKEN = "fictional-bridge-token-at-least-32-characters";
  static final AtomicInteger calls = new AtomicInteger();
  static final AtomicInteger status = new AtomicInteger(200);
  static final AtomicInteger bodyDelayMs = new AtomicInteger();
  static final AtomicReference<String> captured = new AtomicReference<>();
  static final AtomicReference<String> capturedPath = new AtomicReference<>();
  static final AtomicReference<String> auth = new AtomicReference<>();
  static final AtomicReference<String> response = new AtomicReference<>();
  static final HttpServer provider = fakeProvider();
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;

  @TestConfiguration
  static class TestProviderConfig {
    @Bean @Primary SpringAiGateway fakeGateway() {
      return new SpringAiGateway(URI.create("http://127.0.0.1:" + provider.getAddress().getPort()));
    }
  }

  static HttpServer fakeProvider() {
    try {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      com.sun.net.httpserver.HttpHandler handler = exchange -> {
        calls.incrementAndGet();
        capturedPath.set(exchange.getRequestURI().getPath());
        captured.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
        byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status.get(), bytes.length);
        exchange.getResponseBody().flush();
        try { Thread.sleep(bodyDelayMs.get()); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        try { exchange.getResponseBody().write(bytes); } catch (java.io.IOException disconnected) { /* Expected in timeout tests. */ }
        exchange.close();
      };
      server.createContext("/chat/completions", handler);
      server.createContext("/maas/v1/chat/completions", handler);
      server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool(r -> { Thread thread = new Thread(r, "fictional-provider"); thread.setDaemon(true); return thread; }));
      server.start();
      return server;
    } catch (Exception exception) { throw new IllegalStateException("Test provider setup failed"); }
  }

  @BeforeEach void reset() throws Exception {
    calls.set(0); status.set(200); bodyDelayMs.set(0); captured.set(null); capturedPath.set(null); auth.set(null);
    response.set(json.writeValueAsString(java.util.Map.of(
      "id", "fictional-completion-1", "object", "chat.completion", "created", 1, "model", "fictional-model",
      "choices", java.util.List.of(java.util.Map.of("index", 0, "finish_reason", "stop", "message",
        java.util.Map.of("role", "assistant", "content", "{\"ok\":true}", "reasoning_content", "FICTIONAL_PRIVATE_REASONING"))),
      "usage", java.util.Map.of("prompt_tokens", 7, "completion_tokens", 4, "total_tokens", 11))));
  }
  @AfterAll static void close() { provider.stop(0); }

  String request() { return "{\"model\":\"fictional-model\",\"messages\":[{\"role\":\"system\",\"content\":\"Return JSON {ok}\"},{\"role\":\"user\",\"content\":\"Fictional input\"}],\"stream\":false,\"max_tokens\":128}"; }

  @Test void actualChatClientPreservesMessagesUsageAndNeverReturnsReasoning() throws Exception {
    String body = mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
      .header("Authorization", "Bearer fictional-provider-key").contentType("application/json").content(request()))
      .andExpect(status().isOk()).andExpect(jsonPath("$.id").value("fictional-completion-1"))
      .andExpect(jsonPath("$.model").value("fictional-model"))
      .andExpect(jsonPath("$.choices[0].finish_reason").value("stop"))
      .andExpect(jsonPath("$.choices[0].message.content").value("{\"ok\":true}"))
      .andExpect(jsonPath("$.usage.total_tokens").value(11)).andReturn().getResponse().getContentAsString();
    assertThat(body).doesNotContain("reasoning", "FICTIONAL_PRIVATE_REASONING", "fictional-provider-key");
    JsonNode forwarded = json.readTree(captured.get());
    assertThat(forwarded.get("messages").get(0).get("content").asText()).isEqualTo("Return JSON {ok}");
    assertThat(forwarded.get("max_tokens").asInt()).isEqualTo(128);
    assertThat(forwarded.get("stream").asBoolean()).isFalse();
    assertThat(auth.get()).isEqualTo("Bearer fictional-provider-key");
    assertThat(calls.get()).isEqualTo(1);
  }

  @Test void preservesLengthFinishReasonForNodeTruncationHandling() throws Exception {
    response.set(response.get().replace("\"finish_reason\":\"stop\"", "\"finish_reason\":\"length\""));
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
      .header("Authorization", "Bearer fictional-provider-key").contentType("application/json").content(request()))
      .andExpect(status().isOk()).andExpect(jsonPath("$.choices[0].finish_reason").value("length"))
      .andExpect(jsonPath("$.choices[0].message.content").value("{\"ok\":true}"))
      .andExpect(jsonPath("$.usage.prompt_tokens").value(7)).andExpect(jsonPath("$.usage.completion_tokens").value(4));
    assertThat(calls.get()).isEqualTo(1);
  }

  @Test void forwardsAuxiliaryJsonModeAndArabicUnmodified() throws Exception {
    String payload = request().replace("Fictional input", "مرحبا أريد معرفة السعر 😞")
      .replace("\"max_tokens\":128", "\"max_tokens\":128,\"response_format\":{\"type\":\"json_object\"}");
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
      .header("Authorization", "Bearer fictional-provider-key").contentType("application/json").content(payload))
      .andExpect(status().isOk());
    assertThat(json.readTree(captured.get()).path("response_format").path("type").asText()).isEqualTo("json_object");
    assertThat(json.readTree(captured.get()).path("messages").get(1).path("content").asText()).isEqualTo("مرحبا أريد معرفة السعر 😞");
    for (String format : new String[] {"null", "{\"type\":\"text\"}", "{\"type\":\"json_object\",\"extra\":true}"}) {
      mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
        .header("Authorization", "Bearer fictional-provider-key").contentType("application/json")
        .content(request().replace("\"max_tokens\":128", "\"max_tokens\":128,\"response_format\":" + format)))
        .andExpect(status().isBadRequest());
    }
    assertThat(calls.get()).isEqualTo(1);
  }

  @Test void dynamicProviderUnicodeReasoningAndKeylessModeUseActualChatClient() throws Exception {
    String base = "http://127.0.0.1:" + provider.getAddress().getPort() + "/maas/v1";
    String dynamic = request().replace("fictional-model", "智谱𠀀-5.1").replace("\"max_tokens\":128", "\"max_tokens\":65536,\"reasoning_effort\":\"high\"");
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
      .header("X-Provider-Base-Url", base).header("X-Provider-Auth-Mode", "none").header("X-Provider-Timeout-Ms", "1000")
      .header("Authorization", "Bearer stale-fictional-key").contentType("application/json").content(dynamic))
      .andExpect(status().isOk());
    assertThat(auth.get()).isNull();
    assertThat(capturedPath.get()).isEqualTo("/maas/v1/chat/completions");
    JsonNode sent = json.readTree(captured.get());
    assertThat(sent.path("model").asText()).isEqualTo("智谱𠀀-5.1");assertThat(sent.path("max_tokens").asInt()).isEqualTo(65536);
    assertThat(sent.path("reasoning_effort").asText()).isEqualTo("high");assertThat(captured.get()).doesNotContain("X-Provider", "stale-fictional-key");
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
      .header("X-Provider-Base-Url", base).header("X-Provider-Auth-Mode", "bearer").header("X-Provider-Timeout-Ms", "290000")
      .header("Authorization", "Bearer fictional-new-provider-key").contentType("application/json").content(request()))
      .andExpect(status().isOk());
    assertThat(auth.get()).isEqualTo("Bearer fictional-new-provider-key");assertThat(json.readTree(captured.get()).has("reasoning_effort")).isFalse();
  }

  @Test void dynamicMetadataRejectsUnsafeProviderAndInvalidOptionsBeforeSending() throws Exception {
    for (String base : new String[] {"ftp://host/v1", "http://user:pass@host/v1", "http://host/v1?x=1", "http://host/v1#x", "http://host/v1/", "http://host/v1/chat/completions"}) {
      mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("X-Provider-Auth-Mode", "none")
        .header("X-Provider-Base-Url", base).contentType("application/json").content(request())).andExpect(status().isBadRequest());
    }
    for (String timeout : new String[] {"999", "290001", "1.5", "-1"}) {
      mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("X-Provider-Auth-Mode", "none")
        .header("X-Provider-Timeout-Ms", timeout).contentType("application/json").content(request())).andExpect(status().isBadRequest());
    }
    for (String body : new String[] { request().replace("fictional-model", "𠀀".repeat(161)), request().replace("fictional-model", "bad/model"), request().replace("128", "65537"), request().replace("128", "15"), request().replace("128", "128,\"reasoning_effort\":\"medium\"") }) {
      mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("X-Provider-Auth-Mode", "none")
        .contentType("application/json").content(body)).andExpect(status().isBadRequest());
    }
    assertThat(calls.get()).isZero();
  }

  @Test void eachRequestAppliesItsConfiguredUpstreamTimeout() throws Exception {
    bodyDelayMs.set(1400);
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
      .header("X-Provider-Base-Url", "http://127.0.0.1:" + provider.getAddress().getPort()).header("X-Provider-Auth-Mode", "none")
      .header("X-Provider-Timeout-Ms", "1000").contentType("application/json").content(request()))
      .andExpect(status().isGatewayTimeout());
    assertThat(calls.get()).isEqualTo(1);
  }

  @Test void originalNodeArkParserAcceptsActualJavaEnvelopeAndDetectsTruncation() throws Exception {
    var fixture = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(response.get());
    ((com.fasterxml.jackson.databind.node.ObjectNode) fixture.path("choices").get(0).path("message")).put("content",
      json.writeValueAsString(java.util.Map.of("results", java.util.List.of(java.util.Map.of(
        "ruleId", "FICTIONAL-R1", "verdict", "符合", "reason", "Fictional supported conclusion", "evidence", java.util.List.of(1), "referenceIds", java.util.List.of())))));
    java.util.List<JsonNode> envelopes = new java.util.ArrayList<>();
    for (String finish : new String[] {"stop", "length"}) {
      ((com.fasterxml.jackson.databind.node.ObjectNode) fixture.path("choices").get(0)).put("finish_reason", finish);
      response.set(json.writeValueAsString(fixture));
      String body = mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
        .header("Authorization", "Bearer fictional-provider-key").contentType("application/json").content(request()))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
      envelopes.add(json.readTree(body));
    }
    String node = java.nio.file.Files.isRegularFile(java.nio.file.Path.of("D:/NodeJs/node.exe")) ? "D:/NodeJs/node.exe" : "node";
    Process parser = new ProcessBuilder(node, "src/test/js/ark-envelope-contract.mjs").redirectErrorStream(true).start();
    try {
      try (var input = parser.getOutputStream()) { input.write(json.writeValueAsBytes(envelopes)); }
      assertThat(parser.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
      String output = new String(parser.getInputStream().readNBytes(4096), StandardCharsets.UTF_8);
      assertThat(parser.exitValue()).withFailMessage("Node joint contract failed: %s", output).isZero();
      assertThat(output).contains("accepted by original Node Ark parser");
    } finally { if (parser.isAlive()) parser.destroyForcibly(); }
  }

  @Test void bridgeAuthenticationAndLoopbackAreEnforcedBeforeProvider() throws Exception {
    mvc.perform(post("/internal/chat/completions").contentType("application/json").content(request())).andExpect(status().isUnauthorized());
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN)
      .with(r -> { r.setRemoteAddr("192.0.2.8"); return r; }).contentType("application/json").content(request())).andExpect(status().isForbidden());
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("Origin", "http://untrusted.invalid")
      .contentType("application/json").content(request())).andExpect(status().isForbidden());
    assertThat(calls.get()).isZero();
  }

  @Test void invalidMessageAndOversizedBodyNeverReachProvider() throws Exception {
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("Authorization", "Bearer fictional-key")
      .contentType("application/json").content(request().replace("\"user\"", "\"assistant\""))).andExpect(status().isBadRequest());
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("Authorization", "Bearer fictional-key")
      .contentType("application/json").content("x".repeat(2 * 1024 * 1024 + 1))).andExpect(status().isPayloadTooLarge());
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("Authorization", "Bearer fictional-key")
      .contentType("application/json").content("{bad-json-with-fictional-secret")).andExpect(status().isBadRequest())
      .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("fictional-secret"))));
    assertThat(calls.get()).isZero();
  }

  @Test void providerStatusIsSafeAndNeverRetried() throws Exception {
    for (int code : new int[] {400,401,403,404,408,409,422,429,500,503}) {
      calls.set(0); status.set(code); response.set("{\"error\":\"fictional-secret-and-prompt\"}");
      mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("Authorization", "Bearer fictional-key")
        .contentType("application/json").content(request())).andExpect(status().is(code))
        .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("fictional-secret"))));
      assertThat(calls.get()).isEqualTo(1);
    }
  }

  @Test void rejectsTrailingJsonAndDuplicateFields() throws Exception {
    for (String input : new String[] { request() + "{}", request().replace("\"model\":", "\"model\":\"ignored-fictional\",\"model\":") }) {
      mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("Authorization", "Bearer fictional-key")
        .contentType("application/json").content(input)).andExpect(status().isBadRequest());
    }
    assertThat(calls.get()).isZero();
  }

  @Test void oversizedProviderResponseIsRejectedSafely() throws Exception {
    response.set("{\"content\":\"" + "x".repeat(2 * 1024 * 1024 + 1) + "\"}");
    mvc.perform(post("/internal/chat/completions").header("X-Bridge-Token", TOKEN).header("Authorization", "Bearer fictional-key")
      .contentType("application/json").content(request())).andExpect(status().isBadGateway());
    assertThat(calls.get()).isEqualTo(1);
  }

  @Test void timesOutWhileReadingProviderBodyWithoutRetry() {
    bodyDelayMs.set(300);
    SpringAiGateway shortTimeout = new SpringAiGateway(URI.create("http://127.0.0.1:" + provider.getAddress().getPort()), java.time.Duration.ofMillis(100));
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> shortTimeout.complete("fictional-key", "fictional-model",
      java.util.List.of(new org.springframework.ai.chat.messages.UserMessage("Fictional timeout test")), 128))
      .isInstanceOfSatisfying(ProviderFailure.class, failure -> assertThat(failure.status).isEqualTo(504));
    assertThat(calls.get()).isEqualTo(1);
  }

  @Test void healthRequiresBridgeTokenAndReturnsOnlyMinimalState() throws Exception {
    mvc.perform(get("/internal/health")).andExpect(status().isUnauthorized());
    mvc.perform(get("/internal/health").header("X-Bridge-Token", TOKEN)).andExpect(status().isOk())
      .andExpect(jsonPath("$.status").value("ok")).andExpect(jsonPath("$.engine").value("spring-ai"))
      .andExpect(jsonPath("$.version").value("1.0.0")).andExpect(jsonPath("$.springAiVersion").value("1.1.8"));
  }
}
