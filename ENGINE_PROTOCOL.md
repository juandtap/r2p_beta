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
