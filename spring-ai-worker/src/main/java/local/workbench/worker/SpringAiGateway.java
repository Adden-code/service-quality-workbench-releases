package local.workbench.worker;

import io.micrometer.observation.ObservationRegistry;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.ai.openai.api.ResponseFormat;
import org.springframework.ai.model.ApiKey;
import org.springframework.ai.model.NoopApiKey;
import org.springframework.ai.model.SimpleApiKey;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.retry.support.RetryTemplate;
import org.springframework.web.client.RestClient;

class SpringAiGateway {
  static final int MAX_BYTES = 2 * 1024 * 1024;
  static final URI PRODUCTION_PROVIDER = URI.create("https://ark.cn-beijing.volces.com/api/plan/v3");
  private final URI provider;
  private final HttpClient httpClient;
  private final Duration readTimeout;

  SpringAiGateway() { this(PRODUCTION_PROVIDER); }

  // Package-private legacy-default seam for isolated contract tests.
  SpringAiGateway(URI provider) { this(provider, Duration.ofSeconds(120)); }

  SpringAiGateway(URI provider, Duration readTimeout) {
    this.provider = provider;
    this.readTimeout = readTimeout;
    this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER).build();
  }

  Map<String, Object> complete(String apiKey, String model, List<Message> messages, int maxTokens) {
    return complete(null, null, apiKey, model, messages, maxTokens, null);
  }

  Map<String, Object> complete(URI requestedProvider, Duration requestedTimeout, String apiKey,
      String model, List<Message> messages, int maxTokens, String reasoningEffort) {
    return complete(requestedProvider, requestedTimeout, apiKey, model, messages, maxTokens, reasoningEffort, false);
  }

  Map<String, Object> complete(URI requestedProvider, Duration requestedTimeout, String apiKey,
      String model, List<Message> messages, int maxTokens, String reasoningEffort, boolean jsonMode) {
    URI provider = requestedProvider == null ? this.provider : requestedProvider;
    Duration readTimeout = requestedTimeout == null ? this.readTimeout : requestedTimeout;
    long started = System.nanoTime();
    try {
      var requestFactory = new JdkClientHttpRequestFactory(httpClient);
      requestFactory.setReadTimeout(readTimeout);
      var rest = RestClient.builder().requestFactory(requestFactory)
          .requestInterceptor((request, body, execution) -> {
            ClientHttpResponse response = execution.execute(request, body);
            try {
              int status = response.getStatusCode().value();
              if (status < 200 || status >= 300) throw new ProviderFailure(safeStatus(status));
              if (response.getHeaders().getContentLength() > MAX_BYTES) throw new ProviderFailure(502);
              byte[] bytes = response.getBody().readNBytes(MAX_BYTES + 1);
              if (bytes.length > MAX_BYTES) throw new ProviderFailure(502);
              return new BufferedProviderResponse(response.getStatusCode(), response.getHeaders(), bytes);
            } finally { response.close(); }
          });
      ApiKey providerKey = apiKey == null ? new NoopApiKey() : new SimpleApiKey(apiKey);
      OpenAiApi api = OpenAiApi.builder().baseUrl(provider.toString()).completionsPath("/chat/completions")
          .apiKey(providerKey).restClientBuilder(rest).build();
      var optionsBuilder = OpenAiChatOptions.builder().model(model).maxTokens(maxTokens)
          .internalToolExecutionEnabled(false);
      if (reasoningEffort != null) optionsBuilder.reasoningEffort(reasoningEffort);
      if (jsonMode) optionsBuilder.responseFormat(new ResponseFormat(ResponseFormat.Type.JSON_OBJECT, null));
      var options = optionsBuilder
          .internalToolExecutionEnabled(false).build();
      OpenAiChatModel chatModel = OpenAiChatModel.builder().openAiApi(api).defaultOptions(options)
          .retryTemplate(RetryTemplate.builder().maxAttempts(1).build())
          .observationRegistry(ObservationRegistry.NOOP).build();
      ChatResponse result = ChatClient.builder(chatModel).build().prompt(new Prompt(messages, options)).call().chatResponse();
      if (result == null || result.getResults().size() != 1 || result.getResult().getOutput() == null
          || result.getResult().getOutput().getText() == null) throw new ProviderFailure(502);
      String content = result.getResult().getOutput().getText();
      if (content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_BYTES) throw new ProviderFailure(502);
      var metadata = result.getMetadata();
      var usage = metadata.getUsage();
      String finishReason = result.getResult().getMetadata().getFinishReason();
      if (finishReason != null) finishReason = finishReason.strip().toLowerCase(java.util.Locale.ROOT);
      return Map.of("id", metadata.getId() == null ? "" : metadata.getId(),
          "model", metadata.getModel() == null ? model : metadata.getModel(),
          "choices", List.of(Map.of("finish_reason", finishReason == null ? "stop" : finishReason,
              "message", Map.of("role", "assistant", "content", content))),
          "usage", Map.of("prompt_tokens", usage.getPromptTokens(), "completion_tokens", usage.getCompletionTokens(),
              "total_tokens", usage.getTotalTokens()));
    } catch (RuntimeException exception) {
      // Spring wrappers may hold provider bodies/headers; never log or return them.
      for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
        if (cause instanceof ProviderFailure failure) throw failure;
        if (cause instanceof HttpTimeoutException || cause instanceof java.net.SocketTimeoutException)
          throw new ProviderFailure(504);
      }
      if (System.nanoTime() - started >= readTimeout.toNanos()) throw new ProviderFailure(504);
      throw new ProviderFailure(502);
    }
  }

  private static int safeStatus(int status) {
    // Preserve HTTP classification only; provider bodies and headers never leave
    // this gateway. Node decides which statuses are transient for its queue.
    if (status >= 400 && status <= 599) return status;
    return 502;
  }

  private record BufferedProviderResponse(HttpStatusCode status, HttpHeaders headers, byte[] bytes)
      implements ClientHttpResponse {
    public HttpStatusCode getStatusCode() { return status; }
    public String getStatusText() { return "Provider response"; }
    public HttpHeaders getHeaders() { return headers; }
    public InputStream getBody() throws IOException { return new ByteArrayInputStream(bytes); }
    public void close() {}
  }
}

final class ProviderFailure extends RuntimeException {
  final int status;
  ProviderFailure(int status) { super("Model provider request failed", null, false, false); this.status = status; }
}
