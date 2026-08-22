# Game engine protocol

The networking process starts the C executable with piped standard input and
standard output. Both directions use UTF-8 JSON Lines: one JSON object followed
by `\n`.

The engine must reserve `stdout` for protocol messages. Debug logs belong on
`stderr`.

## Engine to network

The engine may produce language-neutral game events. Every event requires a
string `type`.

```json
{"type":"PLAYER_MOVE","direction":"NORTH"}
```

The bridge wraps the object with the authenticated P2P player identity before
sending it to the other peers.

## Network to engine

When the session starts:

```json
{"type":"MATCH_START","selfId":"...","seed":"...","players":["...","..."]}
```

For an event produced by another player's engine:

```json
{"type":"REMOTE_EVENT","playerId":"...","event":{"type":"PLAYER_MOVE","direction":"NORTH"}}
```

Messages may be split or combined by the operating system. The engine must
buffer input until it receives `\n`. The maximum accepted line is 64 KiB.

## Test harness

`examples/mock-engine.c` is a minimal integration harness, not the game engine.
Build and run the networking layer with:

```sh
cc -std=c11 -Wall -Wextra -Werror -O2 \
  examples/mock-engine.c -o mock-engine.bin
node peer.mjs <room-name> --engine ./mock-engine.bin
```

During development, the normal command does those steps automatically. It
recompiles only when the binary is missing or `mock-engine.c` is newer:

```sh
node peer.mjs <room-name>
```

Use `--no-engine` only when testing the networking layer without a child
process. Generated `*.bin` files are intentionally excluded from Git.

After every peer runs `/ready`, the coordinator runs `/start`. Each local mock
engine receives `MATCH_START` and produces `ENGINE_READY`; remote peers display
or forward that event through their own bridge.
