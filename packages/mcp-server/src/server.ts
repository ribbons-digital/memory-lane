import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { MemoryEngine } from "@memory-lane/core"
import type { LoadedPlugin, McpResourceDefinition, McpToolDefinition } from "@memory-lane/plugin-api"
import {
  handleMemoryApprove,
  handleMemoryDelete,
  handleMemoryList,
  handleMemoryRecall,
  handleMemoryReject,
  handleMemoryReview,
  handleMemorySave,
  handleMemoryStatus,
  handleMemorySuggest,
} from "./handlers.js"

export const MEMORY_LANE_TOOL_NAMES = [
  "memory_save",
  "memory_suggest",
  "memory_recall",
  "memory_status",
  "memory_list",
  "memory_review",
  "memory_approve",
  "memory_reject",
  "memory_delete",
] as const

const categorySchema = z.enum(["preference", "personal", "project"])
const scopeSchema = z.enum(["global", "project"])
const statusSchema = z.enum(["pending", "approved", "rejected", "deleted"])
const suggestStatusSchema = z.enum(["pending", "approved"])
const kindSchema = z.enum([
  "preference",
  "personal_context",
  "project_fact",
  "project_checkpoint",
  "workflow_rule",
  "decision",
  "session_summary",
  "misc",
])

const sourceSchema = z.enum(["manual", "user-suggested", "agent-suggested", "session-summary"])
const provenanceSchema = z.string().min(1).describe("Optional adapter/event filter such as pi/session_end, claude/session_end, codex/session_end, or none")
const projectPath = z.string().optional().describe("Optional directory to use for project-scoped Memory Lane operations")
const memoryId = z.string().min(1).describe("Memory Lane memory id")

export interface CreateMemoryLaneMcpServerOptions {
  engine: MemoryEngine
  plugins?: LoadedPlugin[]
}

export function createMemoryLaneMcpServer(options: CreateMemoryLaneMcpServerOptions): McpServer {
  const server = new McpServer({ name: "memory-lane", version: "0.1.0" })
  const engine = options.engine

  server.registerTool(
    "memory_save",
    {
      title: "Save Memory",
      description: "Save an explicit approved Memory Lane memory.",
      inputSchema: {
        text: z.string().min(1),
        category: categorySchema.optional(),
        scope: scopeSchema.optional(),
        kind: kindSchema.optional(),
        projectPath,
      },
    },
    async (input) => handleMemorySave(engine, input),
  )

  server.registerTool(
    "memory_suggest",
    {
      title: "Suggest Memory",
      description: "Queue a pending Memory Lane suggestion, or approve it when status is approved.",
      inputSchema: {
        text: z.string().min(1),
        category: categorySchema.optional(),
        scope: scopeSchema.optional(),
        kind: kindSchema.optional(),
        status: suggestStatusSchema.optional(),
        projectPath,
      },
    },
    async (input) => handleMemorySuggest(engine, input),
  )

  server.registerTool(
    "memory_recall",
    {
      title: "Recall Memories",
      description: "Recall Memory Lane memories relevant to a query.",
      inputSchema: {
        query: z.string().optional(),
        projectPath,
      },
    },
    async (input) => handleMemoryRecall(engine, input),
  )

  server.registerTool(
    "memory_status",
    {
      title: "Memory Lane Status",
      description: "Read Memory Lane status, counts, project scope, and integration diagnostics without modifying memory.",
      inputSchema: {
        projectPath,
      },
    },
    async (input) => handleMemoryStatus(engine, input),
  )

  server.registerTool(
    "memory_list",
    {
      title: "List Memories",
      description: "List Memory Lane memories visible to the current project scope by default. Pass projectPath for current-project queries, especially in desktop clients. Use all=true only for cross-project/admin listings.",
      inputSchema: {
        status: statusSchema.optional(),
        all: z.boolean().optional(),
        projectPath,
      },
    },
    async (input) => handleMemoryList(engine, input),
  )

  server.registerTool(
    "memory_review",
    {
      title: "Review Pending Memories",
      description: "List pending Memory Lane memories for review. Pass projectPath for current-project review context; omit it only for global/cross-project review. Use kind/source/provenance filters to inspect session summaries or other continuity candidates.",
      inputSchema: {
        kind: kindSchema.optional(),
        source: sourceSchema.optional(),
        provenance: provenanceSchema.optional(),
        projectPath,
      },
    },
    async (input) => handleMemoryReview(engine, input),
  )

  server.registerTool(
    "memory_approve",
    {
      title: "Approve Memory",
      description: "Approve a pending Memory Lane memory by id.",
      inputSchema: {
        id: memoryId,
        projectPath,
      },
    },
    async (input) => handleMemoryApprove(engine, input),
  )

  server.registerTool(
    "memory_reject",
    {
      title: "Reject Memory",
      description: "Reject a Memory Lane memory by id.",
      inputSchema: {
        id: memoryId,
        projectPath,
      },
    },
    async (input) => handleMemoryReject(engine, input),
  )

  server.registerTool(
    "memory_delete",
    {
      title: "Delete Memory",
      description: "Soft-delete a Memory Lane memory by id.",
      inputSchema: {
        id: memoryId,
        projectPath,
      },
    },
    async (input) => handleMemoryDelete(engine, input),
  )

  for (const plugin of options.plugins ?? []) {
    for (const tool of plugin.mcpTools) {
      registerPluginTool(server, tool)
    }
    for (const resource of plugin.mcpResources) {
      registerPluginResource(server, resource)
    }
  }

  return server
}

function registerPluginTool(server: McpServer, tool: McpToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as any,
    },
    async (input: Record<string, unknown>) => tool.handler(input),
  )
}

function registerPluginResource(server: McpServer, resource: McpResourceDefinition): void {
  server.resource(
    resource.name,
    resource.uri,
    { description: resource.description, mimeType: resource.mimeType },
    async (uri) => resource.handler(uri),
  )
}
