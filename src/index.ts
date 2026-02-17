#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Junction } from "./junction.js";
import { registerTools } from "./tools.js";
import type { JunctionConfig, KnownHost } from "./types.js";

function parseKnownHosts(raw: string): KnownHost[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((entry) => {
    const [name, hostPort] = entry.trim().split("=");
    if (!name || !hostPort) {
      throw new Error(
        `Invalid JUNCTION_KNOWN_HOSTS entry: "${entry}". Expected name=ip or name=ip:port`
      );
    }
    const [address, portStr] = hostPort.split(":");
    return {
      name: name.trim(),
      address: address.trim(),
      port: portStr ? parseInt(portStr, 10) : 4200,
    };
  });
}

const config: JunctionConfig = {
  port: parseInt(process.env.JUNCTION_PORT ?? "4200", 10),
  host: process.env.JUNCTION_HOST ?? "127.0.0.1",
  sessionTimeoutMs: parseInt(
    process.env.JUNCTION_SESSION_TIMEOUT_MS ?? "1800000",
    10
  ),
  sweepIntervalMs: parseInt(
    process.env.JUNCTION_SWEEP_INTERVAL_MS ?? "60000",
    10
  ),
  knownHosts: parseKnownHosts(process.env.JUNCTION_KNOWN_HOSTS ?? ""),
};

const junction = new Junction(config);
const transports: Record<string, StreamableHTTPServerTransport> = {};
const startTime = Date.now();

function createServer(sessionId: string): McpServer {
  const server = new McpServer({
    name: "agent-junction",
    version: "0.1.0",
  });
  registerTools(server, junction, sessionId, config);
  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

// Health endpoint
app.get("/health", (_req: Request, res: Response) => {
  const isLan = config.host === "0.0.0.0";
  res.json({
    status: "ok",
    mode: isLan ? "lan" : "localhost",
    activePeers: junction.getActivePeerCount(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

// POST /mcp — initialization + JSON-RPC requests
app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const mcpSessionId = randomUUID();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => mcpSessionId,
      });

      const server = createServer(mcpSessionId);
      await server.connect(transport);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          junction.disconnect(sid);
          delete transports[sid];
          console.log(`Session ${sid} disconnected (transport closed)`);
        }
      };

      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        transports[transport.sessionId] = transport;
        console.log(`New session: ${transport.sessionId}`);
      }
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message:
            "Invalid request: missing session ID or not an initialization request",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling POST /mcp:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET /mcp — SSE streaming
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// DELETE /mcp — session termination
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports[sessionId];
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error processing session termination" });
    }
  }
});

// Check if port is already in use
function checkPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true); // port in use
    });
    socket.on("error", () => {
      resolve(false); // port free
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function start() {
  const portInUse = await checkPort(config.host, config.port);
  if (portInUse) {
    console.error(
      `Port ${config.port} is already in use on ${config.host}.`
    );
    console.error(
      `Kill the existing process: fuser -k ${config.port}/tcp`
    );
    process.exit(1);
  }

  const isLan = config.host === "0.0.0.0";
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `Agent Junction running at http://${config.host}:${config.port}`
    );
    console.log(`Mode:   ${isLan ? "LAN (accessible from network)" : "localhost only"}`);
    console.log(`Health: http://${config.host}:${config.port}/health`);
    console.log(`MCP:    http://${config.host}:${config.port}/mcp`);

    if (config.knownHosts.length > 0) {
      console.log(`Known hosts:`);
      for (const h of config.knownHosts) {
        console.log(`  ${h.name} → ${h.address}:${h.port}`);
      }
    }

    if (isLan) {
      console.log(
        `\nRemote clients connect with: http://<this-machine-ip>:${config.port}/mcp`
      );
    }
  });

  // Graceful shutdown
  async function shutdown() {
    console.log("\nShutting down...");

    for (const sessionId in transports) {
      try {
        await transports[sessionId].close();
        delete transports[sessionId];
      } catch {
        // Ignore close errors during shutdown
      }
    }

    junction.shutdown();
    server.close();
    console.log("Junction stopped.");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
