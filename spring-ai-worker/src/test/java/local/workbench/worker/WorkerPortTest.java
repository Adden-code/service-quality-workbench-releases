package local.workbench.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;

class WorkerPortTest {
  @Test void defaultAndIsolatedPorts() {
    assertThat(WorkerConfiguration.parseWorkerPort(null)).isEqualTo(4192);
    assertThat(WorkerConfiguration.parseWorkerPort("45672")).isEqualTo(45672);
  }
  @Test void refusesInvalidPorts() {
    for (String port : new String[] {"", "0", "80", "65536", "04192", "4192/path", "-1", "NaN", "4192\n"}) {
      assertThatThrownBy(() -> WorkerConfiguration.parseWorkerPort(port))
          .isInstanceOf(IllegalStateException.class).hasMessageContaining("WORKBENCH_WORKER_PORT");
    }
  }
  @Test void customizerKeepsLoopbackBinding() {
    var factory = new TomcatServletWebServerFactory();
    new WorkerConfiguration().localListener("45672").customize(factory);
    assertThat(factory.getPort()).isEqualTo(45672);
    assertThat(factory.getAddress().getHostAddress()).isEqualTo("127.0.0.1");
  }
}
