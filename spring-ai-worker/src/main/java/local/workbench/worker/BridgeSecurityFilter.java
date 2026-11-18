package local.workbench.worker;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class BridgeSecurityFilter extends OncePerRequestFilter {
  static final String BODY_ATTRIBUTE = "workbench.bounded-body";
  private final byte[] token;

  BridgeSecurityFilter(@Value("${workbench.bridge-token:}") String token) {
    if (!validToken(token))
      throw new IllegalStateException("WORKBENCH_BRIDGE_TOKEN must contain 32 to 256 safe characters");
    this.token = token.getBytes(StandardCharsets.UTF_8);
  }

  static boolean validToken(String token) {
    return token != null && token.length() >= 32 && token.length() <= 256 && token.matches("[A-Za-z0-9._~-]+");
  }

  @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1").contains(request.getRemoteAddr()) || request.getHeader("Origin") != null) {
      reject(response, 403, "forbidden"); return;
    }
    String candidate = request.getHeader("X-Bridge-Token");
    if (candidate == null || !MessageDigest.isEqual(token, candidate.getBytes(StandardCharsets.UTF_8))) {
      reject(response, 401, "bridge_authorization_failed"); return;
    }
    if ("POST".equals(request.getMethod()) && "/internal/chat/completions".equals(request.getRequestURI())) {
      String type = request.getContentType();
      if (type == null || !type.toLowerCase(java.util.Locale.ROOT).split(";", 2)[0].trim().equals("application/json")) {
        reject(response, 415, "json_required"); return;
      }
      if (request.getContentLengthLong() > SpringAiGateway.MAX_BYTES) {
        reject(response, 413, "request_too_large"); return;
      }
      byte[] body = request.getInputStream().readNBytes(SpringAiGateway.MAX_BYTES + 1);
      if (body.length > SpringAiGateway.MAX_BYTES) { reject(response, 413, "request_too_large"); return; }
      request.setAttribute(BODY_ATTRIBUTE, body);
    }
    try { chain.doFilter(request, response); }
    finally { request.removeAttribute(BODY_ATTRIBUTE); }
  }

  private void reject(HttpServletResponse response, int status, String code) throws IOException {
    response.setStatus(status);
    response.setContentType("application/json");
    response.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"Request rejected\"}}");
  }
}
