# Networking ↔ game contract

The game engine is a JavaScript module. It does not import or use Hyperswarm.
Networking and the game exchange plain JavaScript objects matching this JSON
contract.

## Game module interface

The game object must implement:

```js
game.start({ selfId, seed, players })
game.handleRemoteEvent({ playerId, event })
```

Networking provides a function that the game calls to send an event:

```js
sendGameEvent(event)
```

The integration point in the networking application is `GameAdapter`:

```js
const gameEngine = createGame({
  sendGameEvent: event => gameAdapter.send(event)
})

gameAdapter.attach(gameEngine)
```

The game team owns `createGame` and the event payloads. The networking team
owns `GameAdapter`, player authentication and transport.

## Game event

Every event is a JSON-serializable object with a required string `type` and an
optional `payload` object:

```json
{"type":"PLAYER_MOVE","payload":{"dx":0,"dy":-1}}
```

The game must not add `playerId`. Networking derives it from the authenticated
Hyperswarm connection. A remote game receives:

```json
{
  "playerId":"<authenticated peer public key>",
  "event":{"type":"PLAYER_MOVE","payload":{"dx":0,"dy":-1}}
}
```

Constraints:

- `type` is required and at most 64 characters.
- The complete event must be valid JSON and at most 64 KiB.
- Do not send functions, class instances, cyclic objects or binary buffers.
- Game logs do not travel through this protocol.
- Networking treats `payload` as opaque game-owned data.

## Match start

After every player is ready, all game instances receive the same seed and
ordered player list:

```json
{
  "selfId":"<local player public key>",
  "seed":"<shared dungeon seed>",
  "players":["<player id>","<player id>"]
}
```

The game should not start simulation before this callback.

## Suggested MVP events

The battle-royale MVP uses two network game events.

### Player state

The game sends one state snapshot after a relevant change or at a limited update
rate. `roomId` identifies a dungeon room; it is not the Hyperswarm room/topic.
Networking adds the authenticated `playerId` outside this event.

```json
{
  "type":"PLAYER_STATE",
  "payload":{
    "roomId":"dungeon-room-12",
    "state":"ALIVE",
    "action":"movement",
    "x":14,
    "y":7,
    "seq":42
  }
}
```

`state` is `ALIVE` or `DEAD`. `action` is `idle`, `movement` or `attacking`.
Because combat eliminates a player with one successful hit, no health field is
part of this protocol. `x`, `y` and `seq` are non-negative or signed integers as
appropriate; `seq` must increase for every state sent by one player. Networking
discards duplicated or older states.

Do not send this at an unrestricted render frame rate. For a terminal game,
send on movement/state changes, or cap snapshots around 10–20 updates per
second. Rendering can remain faster and interpolate locally if needed.

The receiving game gets the authenticated identity separately:

```json
{
  "playerId":"<authenticated public key>",
  "event":{
    "type":"PLAYER_STATE",
    "payload":{
      "roomId":"dungeon-room-12",
      "state":"ALIVE",
      "action":"movement",
      "x":14,
      "y":7,
      "seq":42
    }
  }
}
```

### Game over

Only the current session coordinator may announce the final result:

```json
{
  "type":"GAME_OVER",
  "payload":{
    "winnerId":"<player id>",
    "reason":"LAST_PLAYER_ALIVE"
  }
}
```

`winnerId` may be `null` for `DRAW` or `ABORTED`. Valid reasons are
`LAST_PLAYER_ALIVE`, `DRAW` and `ABORTED`.

If the session coordinator exits with `/quit`, `Ctrl+C` or `Ctrl+Z`, networking
sends `GAME_OVER` with `winnerId: null` and `reason: "ABORTED"` before closing.
Every game instance must stop its simulation when it receives `GAME_OVER`.

Additional combat/item events may be added later without changing networking,
as long as they follow the common envelope.

## Random-state integration test

The repository includes a temporary JavaScript game that sends a random player
state every 500 ms after the match starts. Run it on two or more peers with:

```sh
node peer.mjs <same-room-name> --random-game
```

Every peer runs `/ready`, then the coordinator runs `/start`. Logs show outgoing
and authenticated remote state, including increasing `seq` values. The flag is
development-only and will not be part of the final Pear command.
