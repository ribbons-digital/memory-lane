import { main as runMcpServer } from "@memory-lane/mcp-server"

export async function handleMcp(): Promise<void> {
  await runMcpServer()
}
