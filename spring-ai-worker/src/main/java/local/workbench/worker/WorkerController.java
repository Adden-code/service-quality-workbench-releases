package local.workbench.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.core.JsonParser;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class WorkerController {
  private final SpringAiGateway gateway;
  private final ObjectMapper json;
  WorkerController(SpringAiGateway gateway, ObjectMapper json) {
    this.gateway = gateway;
    this.json = json.copy().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
  }

  @GetMapping("/internal/health")
  Map<String, String> health() { return Map.of("status", "ok", "engine", "spring-ai", "version", "1.0.0", "springAiVersion", "1.1.8"); }

  @PostMapping("/internal/chat/completions")
  ResponseEntity<?> completion(HttpServletRequest request) {
    String authMode = request.getHeader("X-Provider-Auth-Mode");
    if (authMode == null) authMode = "bearer";
    if (!Set.of("bearer", "none").contains(authMode)) return invalid();
    String authorization = request.getHeader("Authorization");
    if (authMode.equals("bearer") && (authorization == null || !authorization.startsWith("Bearer ")
        || authorization.substring(7).length() < 8 || authorization.substring(7).length() > 4096
        || java.util.regex.Pattern.compile("[\\s\\p{Cc}]", java.util.regex.Pattern.UNICODE_CHARACTER_CLASS).matcher(authorization.substring(7)).find()))
      return error(401, "provider_authorization_required", "Provider authorization is required");
    try {
      String baseUrl = request.getHeader("X-Provider-Base-Url");
      URI provider = baseUrl == null ? null : providerUri(baseUrl);
      String timeout = request.getHeader("X-Provider-Timeout-Ms");
      Duration readTimeout = null;
      if (timeout != null) {
        if (!timeout.matches("[1-9][0-9]{3,5}")) return invalid();
        int millis = Integer.parseInt(timeout);
        if (millis < 1000 || millis > 290000) return invalid();
        readTimeout = Duration.ofMillis(millis);
      }
      JsonNode root = json.readTree((byte[]) request.getAttribute(BridgeSecurityFilter.BODY_ATTRIBUTE));
      if (root == null || !root.isObject()) return invalid();
      Set<String> allowed = Set.of("model", "messages", "stream", "max_tokens", "reasoning_effort", "response_format");
      var names = root.fieldNames();
      while (names.hasNext()) if (!allowed.contains(names.next())) return invalid();
      JsonNode model = root.path("model"), messages = root.path("messages"), stream = root.path("stream"), tokens = root.path("max_tokens");
      if (!model.isTextual() || !model.asText().matches("[\\p{L}\\p{N}][\\p{L}\\p{N}._-]*")
          || model.asText().codePointCount(0, model.asText().length()) > 160
          || !stream.isBoolean() || stream.booleanValue() || !tokens.isIntegralNumber() || !tokens.canConvertToInt()
          || tokens.intValue() < 16 || tokens.intValue() > 65536 || !messages.isArray()
          || messages.isEmpty() || messages.size() > 16) return invalid();
      JsonNode effort = root.get("reasoning_effort");
      if (effort != null && (!effort.isTextual() || !Set.of("low", "high", "max").contains(effort.asText()))) return invalid();
      JsonNode format = root.get("response_format");
      if (format != null && (!format.isObject() || format.size() != 1 || !format.path("type").asText().equals("json_object"))) return invalid();
      List<Message> prompt = new ArrayList<>();
      for (JsonNode message : messages) {
        if (!message.isObject() || message.size() != 2 || !message.path("content").isTextual()
            || message.path("content").asText().isBlank() || !message.path("role").isTextual()) return invalid();
        String content = message.path("content").asText();
        switch (message.path("role").asText()) {
          case "system" -> prompt.add(new SystemMessage(content));
          case "user" -> prompt.add(new UserMessage(content));
          default -> { return invalid(); }
        }
      }
      return ResponseEntity.ok(gateway.complete(provider, readTimeout, authMode.equals("none") ? null : authorization.substring(7),
          model.asText(), prompt, tokens.intValue(), effort == null ? null : effort.asText(), format != null));
    } catch (ProviderFailure failure) {
      String code = switch (failure.status) {
        case 401, 403 -> "provider_authorization_failed";
        case 429 -> "provider_rate_limited";
        case 408, 504 -> "provider_timeout";
        default -> failure.status >= 400 && failure.status < 500 ? "provider_request_rejected" : "provider_unavailable";
      };
      return error(failure.status, code, "Model provider request failed");
    } catch (IOException | IllegalArgumentException exception) { return invalid(); }
    catch (RuntimeException exception) { return error(502, "provider_unavailable", "Model provider request failed"); }
  }

  private static URI providerUri(String value) {
    URI uri = URI.create(value);
    if (value.length() > 4096 || uri.getScheme() == null || !Set.of("http", "https").contains(uri.getScheme())
        || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
        || uri.getPort() == 0 || uri.getPort() > 65535 || value.endsWith("/") || value.endsWith("/chat/completions")
        || !uri.normalize().equals(uri)) throw new IllegalArgumentException("Invalid provider URL");
    return uri;
  }

  private ResponseEntity<?> invalid() { return error(400, "invalid_request", "Invalid model request"); }
  private ResponseEntity<?> error(int status, String code, String message) {
    return ResponseEntity.status(status).body(Map.of("error", Map.of("code", code, "message", message)));
  }
}
