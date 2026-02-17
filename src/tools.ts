import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Junction } from "./junction.js";
import type { JunctionConfig } from "./types.js";

export function registerTools(
  server: McpServer,
  junction: Junction,
  sessionId: string,
  config: JunctionConfig
): void {
  server.tool(
    "register",
    "Join the Agent Junction. Returns your unique alias and how many other peers are connected.",
    {},
    async () => {
      const result = junction.register(sessionId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_peers",
    "List all other peers currently connected to this Junction.",
    {},
    async () => {
      try {
        const peers = junction.listPeers(sessionId);
        return {
          content: [
            {
              type: "text" as const,
              text:
                peers.length === 0
                  ? "No other peers connected."
                  : JSON.stringify(peers, null, 2),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "send_message",
    "Send an encrypted message to another peer by their alias.",
    {
      target_alias: z.string().describe("The alias of the peer to send the message to"),
      message: z.string().describe("The message content to send"),
    },
    async ({ target_alias, message }) => {
      try {
        junction.sendMessage(sessionId, target_alias, message);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ delivered: true, to: target_alias }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "read_messages",
    "Read and clear all pending messages in your inbox. Messages are deleted after reading.",
    {},
    async () => {
      try {
        const messages = junction.readMessages(sessionId);
        return {
          content: [
            {
              type: "text" as const,
              text:
                messages.length === 0
                  ? "No messages."
                  : JSON.stringify(messages, null, 2),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "known_hosts",
    "List known Junction hosts on the LAN. These are pre-configured machines that may be running their own Junction server. Use their address to configure a remote Junction MCP connection.",
    {},
    async () => {
      if (config.knownHosts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No known hosts configured. Set JUNCTION_KNOWN_HOSTS in the server environment to define LAN peers.",
            },
          ],
        };
      }

      const hosts = config.knownHosts.map((h) => ({
        name: h.name,
        mcpUrl: `http://${h.address}:${h.port}/mcp`,
        healthUrl: `http://${h.address}:${h.port}/health`,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(hosts, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "disconnect",
    "Leave the Junction. Your encryption key is zeroed and all session data is purged.",
    {},
    async () => {
      junction.disconnect(sessionId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ disconnected: true }),
          },
        ],
      };
    }
  );
}
