package local.workbench.worker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class WorkerApplication {
  public static void main(String[] args) {
    if (!BridgeSecurityFilter.validToken(System.getenv("WORKBENCH_BRIDGE_TOKEN"))) {
      System.err.println("Spring AI worker requires WORKBENCH_BRIDGE_TOKEN with 32 to 256 safe characters.");
      System.exit(1);
      return;
    }
    SpringApplication.run(WorkerApplication.class, args);
  }
}
