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

At this milestone, `SERVER_STATUS` is the only remotely enabled operation.
Server IDs accept only letters, numbers, `_`, and `-`.
