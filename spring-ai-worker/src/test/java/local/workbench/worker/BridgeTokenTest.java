package local.workbench.worker;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import org.junit.jupiter.api.Test;

class BridgeTokenTest {
  @Test void refusesMissingShortOrUnsafeStartupToken() {
    for (String token : new String[] {"", "too-short", "fictional-token-with-newline-32-characters\n", "x".repeat(257)}) {
      assertThatThrownBy(() -> new BridgeSecurityFilter(token)).isInstanceOf(IllegalStateException.class)
        .hasMessage("WORKBENCH_BRIDGE_TOKEN must contain 32 to 256 safe characters");
    }
  }
}
