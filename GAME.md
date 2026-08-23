# Aleph Rogue prototype

Run the local playable prototype:

```sh
npm run play
```

Controls:

- `WASD` or arrow keys: move.
- `Space`: attack the adjacent cell in the facing direction.
- `Enter` or `Space`: select a menu option.
- `Escape` or `Ctrl+C`: exit.

The logical 1200×800 surface uses 10×20 pixel reference cells, producing a
120×40 layout. Four rows are reserved for interface information and 36 rows
form the room grid. A terminal displays cells rather than pixels, so these
dimensions are a stable logical reference for a future graphical renderer.

The player occupies an 8×6 terminal-cell sprite (80×120 logical pixels)
generated from the GIF files in `fixtures/`. The highlighted `EXIT` is a door
to the next room. Doors cycle through the generated dungeon; winning is
determined only by the battle-royale `GAME_OVER` event.

The complete dungeon is generated deterministically from the shared match seed
before play begins. The sorted player list assigns each player a different
starting room. The dungeon contains at least two rooms and grows to contain at
least one starting room per player.

`npm run build:sprites` uses Chafa and ImageMagick to preconvert all GIF frames
into `game/ansi-sprites.mjs`. The generated module is distributed with the app,
so end users do not need Chafa installed.

## Rendering boundary

`game/rogue-game.mjs` owns game state and contains no terminal rendering code.
`game/ansi-tui.mjs` maps that state to ANSI/ASCII. A future GIF/PNG renderer can
replace the TUI while preserving movement, rooms and network events. GIF and
PNG assets are not directly rendered by ordinary terminal cells.
