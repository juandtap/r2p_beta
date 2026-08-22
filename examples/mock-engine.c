#include <stdio.h>
#include <string.h>

#define MAX_LINE_BYTES (64 * 1024 + 2)

int main(void) {
  char line[MAX_LINE_BYTES];

  fprintf(stderr, "[MOCK C ENGINE] Started\n");

  while (fgets(line, sizeof(line), stdin) != NULL) {
    fprintf(stderr, "[MOCK C ENGINE] Received: %s", line);

    /*
     * This is only an integration harness, not a JSON parser or game engine.
     * It emits one event when the networking layer starts a match. It stays
     * silent for REMOTE_EVENT to avoid echo loops between peers.
     */
    if (strstr(line, "\"type\":\"MATCH_START\"") != NULL) {
      fputs("{\"type\":\"ENGINE_READY\"}\n", stdout);
      fflush(stdout);
    }
  }

  fprintf(stderr, "[MOCK C ENGINE] Input closed\n");
  return 0;
}
