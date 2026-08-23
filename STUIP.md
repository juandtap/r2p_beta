# Stuip-id

Stuip-id runs on Bare and sends structured server-management intentions over
Hyperswarm. Remote peers never provide a shell command.

## Run two peers

Install dependencies and Bare once:

```sh
npm install
npm install -g bare
```

On both Linux laptops, from the project directory, use the same room name:

```sh
npm start -- hackathon-room
```

Each terminal prints connected peer IDs. Request a remote Minecraft server
status using the full ID or an unambiguous prefix:

```text
/status a1b2c3d4 server01
```

The receiving laptop executes only this allowlisted equivalent:

```text
mc-manager.sh status server01
```

Create a server remotely from a template that exists in the receiving peer's
`minecraft/` directory:

```text
/create a1b2c3d4 server01 minecraft-1.21.1.jar
```

Connected peers receive short local aliases (`peer1`, `peer2`, ...), and common
templates have friendly aliases. The usual flow can therefore be written as:

```text
/create peer1 server01 minecraft
/start peer1 server01
/status peer1 server01
/restart peer1 server01
/stop peer1 server01
```

## Template aliases

The template file must exist in the receiving peer's `minecraft/` directory.

| Alias | Template file | Type/version |
| --- | --- | --- |
| `minecraft` | `minecraft-1.21.1.jar` | Vanilla 1.21.1 |
| `vanilla` | `minecraft-1.21.1.jar` | Vanilla 1.21.1 |
| `forge` | `forge-1.21.1-52.1.0-installer.jar` | Forge 1.21.1 |
| `minecraft120` | `minecraft-1.20.1.jar` | Vanilla 1.20.1 |
| `minecraft121` | `minecraft-1.21.1.jar` | Vanilla 1.21.1 |
| `forge120` | `forge-1.20.1-47.4.10-installer.jar` | Forge 1.20.1 |
| `forge121` | `forge-1.21.1-52.1.0-installer.jar` | Forge 1.21.1 |

Example:

```text
/create peer1 server01 minecraft
```

Manage its lifecycle remotely:

```text
/status a1b2c3d4 server01
/start a1b2c3d4 server01
/stop a1b2c3d4 server01
/restart a1b2c3d4 server01
```

`SERVER_CREATE`, `SERVER_STATUS`, `SERVER_START`, `SERVER_STOP`, and
`SERVER_RESTART` are remotely enabled.
Server IDs accept only letters, numbers, `_`, and `-`; template paths are never
accepted.
