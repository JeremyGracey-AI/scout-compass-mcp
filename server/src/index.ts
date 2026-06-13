/**
 * index.ts — Scout Compass MCP server.
 *
 * Modes:
 *   node dist/index.js              → stdio (Claude Desktop / MCP Inspector)
 *   MODE=http node dist/index.js    → streamable HTTP on :3000/mcp (Foundry remote MCP)
 *
 * Env:
 *   VAULT_PATH  absolute path to the vault directory (default ../vault)
 *   PORT        http port (default 3000)
 */
import path from "node:path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Vault } from "./vault.js";
import { VaultGit } from "./git.js";
import { registerTools } from "./tools.js";
import { registerGroundingTools, groundingSummary } from "./ground.js";

const VAULT_PATH = path.resolve(process.env.VAULT_PATH ?? path.join(process.cwd(), "..", "vault"));
const IQ_STATUS = groundingSummary();

function buildServer(): McpServer {
  const vault = new Vault(VAULT_PATH);
  const git = new VaultGit(VAULT_PATH);
  void git.ensureRepo();
  const server = new McpServer({ name: "scout-compass", version: "0.1.0" });
  registerTools(server, vault, git);
  // Additive, read-only IQ grounding. No-op (registers nothing) unless FOUNDRY_IQ_* is set,
  // so the governed loop stays byte-for-byte identical when IQ is unconfigured.
  registerGroundingTools(server);
  return server;
}

async function mainStdio(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error(`[scout-compass] stdio mode, vault: ${VAULT_PATH} | ${IQ_STATUS}`);
}

async function mainHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Stateless mode: every request gets a fresh server+transport pair.
  // Simplest reliable wiring for Foundry's remote MCP client; fine at demo scale.
  app.post("/mcp", async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, vault: VAULT_PATH });
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.error(`[scout-compass] http mode on :${port}/mcp, vault: ${VAULT_PATH} | ${IQ_STATUS}`);
  });
}

if (process.env.MODE === "http") {
  void mainHttp();
} else {
  void mainStdio();
}
