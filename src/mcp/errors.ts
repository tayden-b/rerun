/** A call named (or resolved to) a workspace or organization other than the one the client is scoped to. */
export class WorkspaceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceScopeError';
  }
}

/** A tool outside the SPEC §5 allowlist (`src/mcp/allowlist.ts`). */
export class ToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`Terraform MCP tool "${tool}" is not in the Rerun allowlist (SPEC §5).`);
    this.name = 'ToolNotAllowedError';
  }
}

/** The MCP server answered a tool call with `isError: true`. The message is redacted. */
export class McpToolError extends Error {
  constructor(
    readonly tool: string,
    readonly detail: string,
  ) {
    super(`Terraform MCP tool "${tool}" failed: ${detail}`);
    this.name = 'McpToolError';
  }
}
