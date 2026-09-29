#!/usr/bin/env node
/**
 * `npx @qorpiq/mcp-server`: stdio transport for clients that cannot speak Streamable HTTP.
 * Set QORPIQ_MCP_BASE_URL to point at a different host (for example a local dev Worker).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHttpBackend, DEFAULT_BASE_URL } from './http-backend.js'
import { createQorpiqMcpServer } from './tools.js'

async function main() {
  const server = createQorpiqMcpServer({
    backend: createHttpBackend(process.env.QORPIQ_MCP_BASE_URL || DEFAULT_BASE_URL),
  })
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
