# Agent Junction — Architecture Diagrams

## System Overview (Localhost Mode)

```mermaid
graph TB
    subgraph Host Machine
        CC1[Claude Code 1<br/><i>crimson-falcon</i>]
        CC2[Claude Code 2<br/><i>quiet-harbor</i>]
        CC3[Claude Code 3<br/><i>swift-lantern</i>]

        subgraph Junction Server [Agent Junction ·127.0.0.1:4200]
            MCP[MCP Endpoint<br/>/mcp]
            Health[Health Endpoint<br/>/health]
            J[Junction Singleton<br/><i>in-memory state</i>]
            Sweep[Expiry Sweep<br/><i>every 60s</i>]
        end

        CC1 <-->|StreamableHTTP| MCP
        CC2 <-->|StreamableHTTP| MCP
        CC3 <-->|StreamableHTTP| MCP
        MCP --- J
        Sweep -.->|purge idle| J
    end

    style Junction Server fill:#1a1a2e,stroke:#e94560,color:#eee
    style J fill:#0f3460,stroke:#e94560,color:#eee
    style CC1 fill:#16213e,stroke:#53a8b6,color:#eee
    style CC2 fill:#16213e,stroke:#53a8b6,color:#eee
    style CC3 fill:#16213e,stroke:#53a8b6,color:#eee
```

## System Overview (LAN Mode)

```mermaid
graph TB
    subgraph Workstation ["Workstation (10.0.0.6)"]
        CC1[Claude Code 1<br/><i>crimson-falcon</i>]
        CC2[Claude Code 2<br/><i>quiet-harbor</i>]

        subgraph Junction Server [Agent Junction ·0.0.0.0:4200]
            MCP[MCP Endpoint<br/>/mcp]
            Health[Health Endpoint<br/>/health]
            J[Junction Singleton]
            KH[Known Hosts<br/><i>vm, nas, ...</i>]
        end

        CC1 <-->|localhost| MCP
        CC2 <-->|localhost| MCP
    end

    subgraph VM ["Ubuntu VM (10.0.0.4)"]
        CC3[Claude Code 3<br/><i>swift-lantern</i>]
    end

    subgraph NAS ["NAS (10.0.0.50)"]
        CC4[Claude Code 4<br/><i>deep-harbor</i>]
    end

    CC3 <-->|"LAN (10.0.0.6:4200)"| MCP
    CC4 <-->|"LAN (10.0.0.6:4200)"| MCP

    style Junction Server fill:#1a1a2e,stroke:#e94560,color:#eee
    style J fill:#0f3460,stroke:#e94560,color:#eee
    style Workstation fill:#0a0a1a,stroke:#53a8b6,color:#eee
    style VM fill:#0a0a1a,stroke:#53a8b6,color:#eee
    style NAS fill:#0a0a1a,stroke:#53a8b6,color:#eee
    style CC1 fill:#16213e,stroke:#53a8b6,color:#eee
    style CC2 fill:#16213e,stroke:#53a8b6,color:#eee
    style CC3 fill:#16213e,stroke:#53a8b6,color:#eee
    style CC4 fill:#16213e,stroke:#53a8b6,color:#eee
```

## Session Lifecycle

```mermaid
sequenceDiagram
    participant C1 as Claude 1 (local)
    participant J as Junction Server
    participant C2 as Claude 2 (LAN)

    Note over C1,C2: Phase 1 — Registration
    C1->>J: register()
    J-->>C1: { alias: "crimson-falcon", peer_count: 0 }
    C2->>J: register()
    J-->>C2: { alias: "quiet-harbor", peer_count: 1 }

    Note over C1,C2: Phase 2 — Discovery
    C1->>J: list_peers()
    J-->>C1: [{ alias: "quiet-harbor" }]
    C2->>J: known_hosts()
    J-->>C2: [{ name: "workstation", mcpUrl: "..." }]

    Note over C1,C2: Phase 3 — Message Exchange
    C1->>J: send_message("quiet-harbor", "R2 bucket is xyz...")
    J->>J: Encrypt with quiet-harbor's AES key
    J-->>C1: { delivered: true }
    C2->>J: read_messages()
    J->>J: Decrypt + delete (destructive read)
    J-->>C2: [{ from: "crimson-falcon", message: "R2 bucket is xyz..." }]

    Note over C1,C2: Phase 4 — Disconnect
    C2->>J: disconnect()
    J->>J: Zero key, purge session
    J-->>C2: { disconnected: true }
    C1->>J: disconnect()
    J->>J: Zero key, purge session
    J-->>C1: { disconnected: true }
```

## Encryption Flow

```mermaid
flowchart LR
    subgraph Sender["Sender (crimson-falcon)"]
        PT[Plaintext Message]
    end

    subgraph Server["Junction Server"]
        direction TB
        LK[Look up target's<br/>AES-256 key]
        IV[Generate random<br/>12-byte IV]
        ENC[AES-256-GCM<br/>Encrypt]
        CT[Ciphertext +<br/>Auth Tag + IV]
        INBOX[Target's Inbox]

        LK --> ENC
        IV --> ENC
        ENC --> CT
        CT --> INBOX
    end

    subgraph Reader["Reader (quiet-harbor)"]
        DEC[AES-256-GCM<br/>Decrypt]
        MSG[Plaintext Message]
        DEC --> MSG
    end

    PT --> ENC
    INBOX -->|read_messages| DEC

    style Server fill:#1a1a2e,stroke:#e94560,color:#eee
    style Sender fill:#16213e,stroke:#53a8b6,color:#eee
    style Reader fill:#16213e,stroke:#53a8b6,color:#eee
```

## Internal Data Model

```mermaid
classDiagram
    class Junction {
        -Map~string, PeerSession~ sessions
        -sweepInterval: NodeJS.Timeout
        -config: JunctionConfig
        +register(sessionId) RegisterResult
        +listPeers(sessionId) PeerInfo[]
        +sendMessage(sessionId, targetAlias, message) void
        +readMessages(sessionId) DecodedMessage[]
        +disconnect(sessionId) void
        +getActivePeerCount() number
        +shutdown() void
        -sweepExpired() void
    }

    class JunctionConfig {
        +port: number
        +host: string
        +sessionTimeoutMs: number
        +sweepIntervalMs: number
        +knownHosts: KnownHost[]
    }

    class KnownHost {
        +name: string
        +address: string
        +port: number
    }

    class PeerSession {
        +sessionId: string
        +alias: string
        +encryptionKey: Buffer
        +inbox: EncryptedMessage[]
        +connectedAt: Date
        +lastActivity: Date
    }

    class EncryptedMessage {
        +fromAlias: string
        +ciphertext: Buffer
        +iv: Buffer
        +authTag: Buffer
        +timestamp: Date
    }

    class DecodedMessage {
        +from: string
        +message: string
        +timestamp: string
    }

    Junction --> JunctionConfig : configured by
    JunctionConfig --> "*" KnownHost : defines
    Junction "1" --> "*" PeerSession : manages
    PeerSession "1" --> "*" EncryptedMessage : inbox
    EncryptedMessage ..> DecodedMessage : decrypt()
```

## Module Dependency Graph

```mermaid
graph BT
    index[src/index.ts<br/><i>Express + MCP server<br/>port check, config parsing</i>]
    tools[src/tools.ts<br/><i>6 MCP tools incl. known_hosts</i>]
    junction[src/junction.ts<br/><i>Core state manager</i>]
    crypto[src/crypto.ts<br/><i>AES-256-GCM</i>]
    aliases[src/aliases.ts<br/><i>Alias generator</i>]
    types[src/types.ts<br/><i>Interfaces + KnownHost</i>]

    index --> tools
    tools --> junction
    tools --> types
    junction --> crypto
    junction --> aliases
    junction --> types

    style index fill:#e94560,stroke:#eee,color:#fff
    style tools fill:#0f3460,stroke:#eee,color:#fff
    style junction fill:#0f3460,stroke:#eee,color:#fff
    style crypto fill:#16213e,stroke:#eee,color:#fff
    style aliases fill:#16213e,stroke:#eee,color:#fff
    style types fill:#16213e,stroke:#eee,color:#fff
```

## Auto-Expiry Mechanism

```mermaid
stateDiagram-v2
    [*] --> Active: register()
    Active --> Active: send/read/list\n(resets lastActivity)
    Active --> Expired: lastActivity > timeout
    Active --> Disconnected: disconnect()
    Expired --> [*]: sweep purges session\n(key zeroed)
    Disconnected --> [*]: key zeroed,\ndata purged
```

## Deployment Topology

```mermaid
graph LR
    subgraph Option A [Localhost Only]
        direction TB
        A_J[Junction<br/>127.0.0.1:4200]
        A_C1[Claude 1] <--> A_J
        A_C2[Claude 2] <--> A_J
    end

    subgraph Option B [LAN Hub]
        direction TB
        B_J[Junction<br/>0.0.0.0:4200]
        B_C1[Claude local] <--> B_J
        B_C2[Claude on VM] <-->|LAN| B_J
        B_C3[Claude on NAS] <-->|LAN| B_J
    end

    style Option A fill:#0a0a1a,stroke:#53a8b6,color:#eee
    style Option B fill:#0a0a1a,stroke:#e94560,color:#eee
    style A_J fill:#1a1a2e,stroke:#53a8b6,color:#eee
    style B_J fill:#1a1a2e,stroke:#e94560,color:#eee
```
