package local.workbench.worker;

import java.net.InetAddress;
import java.net.UnknownHostException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class WorkerConfiguration {
  @Bean SpringAiGateway gateway() { return new SpringAiGateway(); }
  static int parseWorkerPort(String value) {
    if (value == null) return 4192;
    if (!value.matches("[1-9][0-9]{3,4}")) throw new IllegalStateException("Invalid WORKBENCH_WORKER_PORT");
    int port = Integer.parseInt(value);
    if (port < 1024 || port > 65535) throw new IllegalStateException("Invalid WORKBENCH_WORKER_PORT");
    return port;
  }
  @Bean WebServerFactoryCustomizer<TomcatServletWebServerFactory> localListener(
      @Value("${workbench.worker-port:4192}") String configuredPort) {
    int port = parseWorkerPort(configuredPort);
    return factory -> {
      try { factory.setAddress(InetAddress.getByName("127.0.0.1")); }
      catch (UnknownHostException exception) { throw new IllegalStateException("Loopback configuration failed"); }
      factory.setPort(port);
    };
  }
}
