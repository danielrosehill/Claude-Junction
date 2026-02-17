# Agent Junction — Specification

## Problem

Multiple Claude Code instances — on the same host or across a LAN — frequently possess information the others need: config paths, secrets, environment variables, API endpoints. Currently the human must manually relay this between sessions, breaking flow.

## Solution

Agent Junction is a lightweight MCP server that provides an ephemeral, encrypted peer-to-peer message bus between Claude Code instances. It supports two modes:

- **Localhost mode** (default) — binds to `127.0.0.1`, connects instances on the same machine
- **LAN mode** — binds to `0.0.0.0`, allows instances on different machines to communicate

## Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Localhost by default** | Binds to `127.0.0.1` unless explicitly configured for LAN |
| **LAN-capable** | Set `JUNCTION_HOST=0.0.0.0` to accept connections from the local network |
| **Ephemeral** | All state is in-memory, nothing persists to disk |
| **Encrypted at rest** | AES-256-GCM per-session keys — secrets are never stored in plaintext, even in memory |
| **Destructive reads** | Messages are deleted after reading — no accumulation |
| **Auto-expiry** | Idle sessions are purged after a configurable timeout (default 30 min) |
| **Key zeroing** | Encryption keys are overwritten with zeros on disconnect |
| **Stale process detection** | Checks port availability on startup, advises cleanup |

## Transport

**StreamableHTTP** (not stdio) — because multiple independent Claude Code clients must connect to the same server process concurrently. Each client gets its own MCP session backed by a shared `Junction` singleton.

## Tools

| Tool | Input | Returns | Purpose |
|------|-------|---------|---------|
| `register` | — | `{ alias, session_id, peer_count }` | Join the junction, receive a human-readable alias |
| `list_peers` | — | `PeerInfo[]` | See all other connected peers and their aliases |
| `send_message` | `target_alias`, `message` | `{ delivered: true }` | Encrypt and deliver a message to a peer's inbox |
| `read_messages` | — | `DecodedMessage[]` | Decrypt, return, and delete all pending messages |
| `known_hosts` | — | `KnownHost[]` | List pre-configured LAN hosts running Junction |
| `disconnect` | — | `{ disconnected: true }` | Leave the junction, zero keys, purge all data |

## Alias System

Each peer gets a unique human-readable alias generated from adjective-noun word lists (~90 words each, ~8000+ combinations). Examples: `crimson-falcon`, `quiet-harbor`, `swift-lantern`. This lets agents refer to each other naturally in conversation.

## Encryption Model

- Each session generates a unique 256-bit AES key on registration
- Messages are encrypted with the **target's** key using AES-256-GCM
- Random 12-byte IV per message, with authentication tag for integrity
- Keys are zeroed (overwritten with `0x00`) on disconnect
- No keys or plaintext ever touch disk

## Session Lifecycle

1. **Register** — Agent connects, receives alias + session ID + encryption key (held server-side)
2. **Exchange** — Agents discover each other via `list_peers`, send/read encrypted messages
3. **Disconnect** — Agent explicitly disconnects or session expires; all data is purged

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `JUNCTION_PORT` | `4200` | HTTP listen port |
| `JUNCTION_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN mode) |
| `JUNCTION_SESSION_TIMEOUT_MS` | `1800000` | Session expiry (30 min) |
| `JUNCTION_SWEEP_INTERVAL_MS` | `60000` | How often to check for expired sessions |
| `JUNCTION_KNOWN_HOSTS` | *(empty)* | Comma-separated `name=ip` or `name=ip:port` |

## Known Hosts

The `JUNCTION_KNOWN_HOSTS` environment variable lets you define named LAN machines that may be running their own Junction server. Agents can query these with the `known_hosts` tool to discover connection URLs.

Example:
```
JUNCTION_KNOWN_HOSTS=workstation=10.0.0.6,vm=10.0.0.4,nas=10.0.0.50:4200
```

This produces:
```json
[
  { "name": "workstation", "mcpUrl": "http://10.0.0.6:4200/mcp" },
  { "name": "vm", "mcpUrl": "http://10.0.0.4:4200/mcp" },
  { "name": "nas", "mcpUrl": "http://10.0.0.50:4200/mcp" }
]
```

## MCP Client Configuration

### Localhost (same machine)
```json
{
  "mcpServers": {
    "junction": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:4200/mcp"
    }
  }
}
```

### LAN (remote machine at 10.0.0.6)
```json
{
  "mcpServers": {
    "junction": {
      "type": "streamable-http",
      "url": "http://10.0.0.6:4200/mcp"
    }
  }
}
```

## Health Endpoint

`GET /health` returns:

```json
{
  "status": "ok",
  "mode": "lan",
  "activePeers": 2,
  "uptime": 3600
}
```
