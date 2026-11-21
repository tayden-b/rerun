import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { dynamicTool, jsonSchema, type JSONSchema7, type ToolSet } from 'ai';
import { redact } from '../shared/redact';
import { REGISTRY_TOOLS, isAllowedTool, type AllowedTool } from './allowlist';
import { McpToolError, ToolNotAllowedError, WorkspaceScopeError } from './errors';
import { dig, isRecord, parseToolText, relationshipId, resource } from './parse';

// Client choice: the MCP SDK `Client` + `StreamableHTTPClientTransport` directly, not `createMCPClient`
// from `@ai-sdk/mcp` (`experimental_createMCPClient` is gone from `ai@6`). Every call must pass the
// allowlist and workspace-scope checks below before it reaches the server; the AI SDK client's `tools()`
// hands the model the server's tools unmediated. `tools()` here builds the AI SDK `ToolSet` itself with
// `dynamicTool` + `jsonSchema`, routed through the same checks. It also avoids another dependency.

export interface TerraformMcpOptions {
  url: string;
  /** HCP Terraform workspace every call is scoped to (`RERUN_WORKSPACE`). */
  workspace: string;
  /** HCP Terraform organization (`TFE_ORG`). */
  org: string;
  /** Debug sink for redacted, truncated tool output. Nothing is logged when unset. */
  debug?: (message: string) => void;
}

export interface ToolResult {
  tool: AllowedTool;
  /** Arguments sent, including the injected scope. */
  args: Record<string, unknown>;
  /** The MCP `tools/call` result, untouched. */
  raw: CallToolResult;
  /** Concatenated text content. */
  text: string;
  /** `text` parsed tolerantly: JSON when parseable, else `{ text }`. */
  data: unknown;
}

export interface RunListItem {
  id: string;
  status: string;
  message?: string;
  source?: string;
  created_at?: string;
  has_changes?: boolean;
  workspace_name?: string;
  [key: string]: unknown;
}

export type ToolObserverEvent =
  | { phase: 'call'; tool: AllowedTool; args: Record<string, unknown> }
  | {
      phase: 'result';
      tool: AllowedTool;
      args: Record<string, unknown>;
      result: ToolResult;
      durationMs: number;
    }
  | { phase: 'error'; tool: AllowedTool; args: Record<string, unknown>; error: Error; durationMs: number };
export type ToolObserver = (event: ToolObserverEvent) => void;

export type ProviderDocumentType =
  'resources' | 'data-sources' | 'functions' | 'guides' | 'overview' | 'actions' | 'list-resources';

export interface TerraformMcp {
  readonly org: string;
  readonly workspace: string;
  /** Low-level allowlisted call; scope arguments are checked and injected. */
  call(tool: string, args?: Record<string, unknown>): Promise<ToolResult>;
  whoami(): Promise<ToolResult>;
  listRuns(opts?: {
    status?: string | string[];
    pageSize?: number;
    page?: number;
    workspace?: string;
  }): Promise<ToolResult & { runs: RunListItem[] }>;
  /** Fetches the run and throws `WorkspaceScopeError` when it belongs to another workspace. */
  getRunDetails(runId: string): Promise<ToolResult>;
  getPlanDetails(planId: string): Promise<ToolResult>;
  getPlanLogs(planId: string): Promise<ToolResult>;
  getPlanJsonOutput(planId: string): Promise<ToolResult>;
  getApplyDetails(applyId: string): Promise<ToolResult>;
  getApplyLogs(applyId: string): Promise<ToolResult>;
  getWorkspaceDetails(opts?: { workspace?: string }): Promise<ToolResult & { workspaceId: string }>;
  listStateVersions(opts?: { pageSize?: number; page?: number; workspace?: string }): Promise<ToolResult>;
  /** Latest state version of the workspace, or a specific one listed for it. */
  getStateVersion(opts?: { stateVersionId?: string }): Promise<ToolResult>;
  getRunComments(runId: string): Promise<ToolResult>;
  searchProviderDocs(opts: {
    providerName: string;
    providerNamespace: string;
    serviceSlug: string;
    providerDocumentType: ProviderDocumentType;
    providerVersion?: string;
  }): Promise<ToolResult>;
  getProviderDetails(providerDocId: string): Promise<ToolResult>;
  getLatestProviderVersion(opts: { namespace: string; name: string }): Promise<ToolResult>;
  getProviderCapabilities(opts: { namespace: string; name: string; version?: string }): Promise<ToolResult>;
  /** Registry toolset only, as an AI SDK `ToolSet` for agents. */
  tools(): Promise<ToolSet>;
  /** Same connection and scope caches, plus an observer for every call made through the returned view. */
  withObserver(observer: ToolObserver): TerraformMcp;
  close(): Promise<void>;
}

/** Tools whose `workspace_name` / `terraform_org_name` the client fills in (from `fixtures/mcp/tools-list.json`). */
const WORKSPACE_ARG_TOOLS: readonly string[] = ['get_workspace_details', 'list_runs', 'list_state_versions'];
const ORG_ARG_TOOLS: readonly string[] = [
  'list_workspaces',
  'get_workspace_details',
  'list_runs',
  'list_state_versions',
];
const PLAN_TOOLS: readonly string[] = ['get_plan_details', 'get_plan_logs', 'get_plan_json_output'];
const APPLY_TOOLS: readonly string[] = ['get_apply_details', 'get_apply_logs'];

const DEBUG_PREVIEW = 2000;

interface Scope {
  workspaceId?: Promise<string>;
  verifiedRuns: Set<string>;
  plans: Set<string>;
  applies: Set<string>;
  stateVersions: Set<string>;
  listedTools?: Promise<McpTool[]>;
}

function textOf(result: CallToolResult): string {
  return (result.content ?? []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
}

function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function stateVersionIds(data: unknown): string[] {
  const items = dig(data, 'items') ?? dig(data, 'data');
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => (isRecord(i) ? i.id : undefined))
    .filter((id): id is string => typeof id === 'string');
}

export async function createTerraformMcp(opts: TerraformMcpOptions): Promise<TerraformMcp> {
  const client = new Client({ name: 'rerun', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(opts.url)));
  const scope: Scope = {
    verifiedRuns: new Set(),
    plans: new Set(),
    applies: new Set(),
    stateVersions: new Set(),
  };
  return buildView(client, scope, opts, []);
}

function buildView(
  client: Client,
  scope: Scope,
  opts: TerraformMcpOptions,
  observers: ToolObserver[],
): TerraformMcp {
  const { org, workspace } = opts;

  function notify(event: ToolObserverEvent) {
    for (const o of observers) o(event);
  }

  function assertScopeArgs(tool: string, args: Record<string, unknown>): void {
    if (
      'terraform_org_name' in args &&
      args.terraform_org_name !== undefined &&
      args.terraform_org_name !== org
    ) {
      throw new WorkspaceScopeError(
        `${tool}: organization "${String(args.terraform_org_name)}" is outside the client scope`,
      );
    }
    if ('workspace_name' in args && args.workspace_name !== undefined && args.workspace_name !== workspace) {
      throw new WorkspaceScopeError(
        `${tool}: workspace "${String(args.workspace_name)}" is outside the client scope ("${workspace}")`,
      );
    }
  }

  function checkScope(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    assertScopeArgs(tool, args);
    const out = { ...args };
    if (ORG_ARG_TOOLS.includes(tool)) out.terraform_org_name = org;
    if (WORKSPACE_ARG_TOOLS.includes(tool)) out.workspace_name = workspace;
    if (tool === 'list_workspaces') {
      // Proves the scope filter only: the listing can be read, but details for any other name are refused.
      delete out.workspace_name;
    }
    if (PLAN_TOOLS.includes(tool) && !scope.plans.has(String(out.plan_id))) {
      throw new WorkspaceScopeError(
        `${tool}: plan "${String(out.plan_id)}" does not belong to a run verified in "${workspace}"; call getRunDetails first`,
      );
    }
    if (APPLY_TOOLS.includes(tool) && !scope.applies.has(String(out.apply_id))) {
      throw new WorkspaceScopeError(
        `${tool}: apply "${String(out.apply_id)}" does not belong to a run verified in "${workspace}"; call getRunDetails first`,
      );
    }
    return out;
  }

  /** `validate` runs before observers see the result, so a rejected result is never published. */
  async function rawCall(
    tool: AllowedTool,
    args: Record<string, unknown>,
    validate?: (result: ToolResult) => void,
  ): Promise<ToolResult> {
    notify({ phase: 'call', tool, args });
    const started = Date.now();
    try {
      const raw = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
      const text = textOf(raw);
      opts.debug?.(`terraform-mcp ${tool} -> ${redact(text).slice(0, DEBUG_PREVIEW)}`);
      if (raw.isError) throw new McpToolError(tool, redact(text));
      const result: ToolResult = { tool, args, raw, text, data: parseToolText(text) };
      validate?.(result);
      notify({ phase: 'result', tool, args, result, durationMs: Date.now() - started });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      notify({ phase: 'error', tool, args, error, durationMs: Date.now() - started });
      throw error;
    }
  }

  async function call(tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (!isAllowedTool(tool)) throw new ToolNotAllowedError(tool);
    assertScopeArgs(tool, args);
    if (args.workspace_id !== undefined && args.workspace_id !== (await workspaceId())) {
      throw new WorkspaceScopeError(
        `${tool}: workspace id "${String(args.workspace_id)}" is outside the client scope`,
      );
    }
    if (tool === 'get_run_details') return getRunDetails(String(args.run_id));
    if (tool === 'get_run_comments') return getRunComments(String(args.run_id));
    if (tool === 'get_state_version') {
      return getStateVersion({ stateVersionId: args.state_version_id as string | undefined });
    }
    return rawCall(tool, checkScope(tool, compact(args)));
  }

  async function getWorkspaceDetails(o: { workspace?: string } = {}) {
    const result = await rawCall(
      'get_workspace_details',
      checkScope('get_workspace_details', { workspace_name: o.workspace ?? workspace }),
    );
    const id = dig(result.data, 'data', 'attributes', 'workspace_id') ?? dig(resource(result.data), 'id');
    if (typeof id !== 'string') {
      throw new McpToolError('get_workspace_details', 'response has no workspace id');
    }
    scope.workspaceId ??= Promise.resolve(id);
    return { ...result, workspaceId: id };
  }

  function workspaceId(): Promise<string> {
    scope.workspaceId ??= getWorkspaceDetails().then((r) => r.workspaceId);
    scope.workspaceId.catch(() => {
      scope.workspaceId = undefined;
    });
    return scope.workspaceId;
  }

  async function getRunDetails(runId: string): Promise<ToolResult> {
    const expected = await workspaceId();
    const result = await rawCall('get_run_details', { run_id: runId }, (r) => {
      const actual = relationshipId(r.data, 'workspace');
      if (actual !== expected) {
        throw new WorkspaceScopeError(
          `get_run_details: run "${runId}" belongs to workspace "${actual ?? 'unknown'}", not "${workspace}" (${expected})`,
        );
      }
    });
    scope.verifiedRuns.add(runId);
    const plan = relationshipId(result.data, 'plan');
    const apply = relationshipId(result.data, 'apply');
    if (plan) scope.plans.add(plan);
    if (apply) scope.applies.add(apply);
    return result;
  }

  async function getRunComments(runId: string): Promise<ToolResult> {
    if (!scope.verifiedRuns.has(runId)) await getRunDetails(runId);
    return rawCall('get_run_comments', { run_id: runId });
  }

  async function listStateVersions(o: { pageSize?: number; page?: number; workspace?: string } = {}) {
    const result = await rawCall(
      'list_state_versions',
      checkScope(
        'list_state_versions',
        compact({ workspace_name: o.workspace, pageSize: o.pageSize, page: o.page }),
      ),
    );
    for (const id of stateVersionIds(result.data)) scope.stateVersions.add(id);
    return result;
  }

  async function getStateVersion(o: { stateVersionId?: string } = {}): Promise<ToolResult> {
    if (o.stateVersionId === undefined) {
      return rawCall('get_state_version', { workspace_id: await workspaceId() });
    }
    if (!scope.stateVersions.has(o.stateVersionId)) await listStateVersions({ pageSize: 100 });
    if (!scope.stateVersions.has(o.stateVersionId)) {
      throw new WorkspaceScopeError(
        `get_state_version: "${o.stateVersionId}" is not a state version of "${workspace}"`,
      );
    }
    return rawCall('get_state_version', { state_version_id: o.stateVersionId });
  }

  async function listRuns(
    o: { status?: string | string[]; pageSize?: number; page?: number; workspace?: string } = {},
  ) {
    const status = o.status === undefined ? undefined : Array.isArray(o.status) ? o.status : [o.status];
    const result = await rawCall(
      'list_runs',
      checkScope(
        'list_runs',
        compact({ workspace_name: o.workspace, status, pageSize: o.pageSize, page: o.page }),
      ),
    );
    const items = dig(result.data, 'items') ?? dig(result.data, 'data');
    const runs = (Array.isArray(items) ? items : []).filter(
      (r): r is RunListItem => isRecord(r) && typeof r.id === 'string',
    );
    return { ...result, runs };
  }

  async function tools(): Promise<ToolSet> {
    scope.listedTools ??= client.listTools().then(
      (r) => r.tools,
      (err: unknown) => {
        scope.listedTools = undefined;
        throw err;
      },
    );
    const listed = await scope.listedTools;
    const set: ToolSet = {};
    for (const t of listed) {
      if (!(REGISTRY_TOOLS as readonly string[]).includes(t.name)) continue;
      set[t.name] = dynamicTool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema as JSONSchema7),
        execute: async (input) => {
          const result = await call(t.name, isRecord(input) ? input : {});
          return result.text;
        },
      });
    }
    return set;
  }

  return {
    org,
    workspace,
    call,
    whoami: () => rawCall('whoami', {}),
    listRuns,
    getRunDetails,
    getPlanDetails: (planId) => call('get_plan_details', { plan_id: planId }),
    getPlanLogs: (planId) => call('get_plan_logs', { plan_id: planId }),
    getPlanJsonOutput: (planId) => call('get_plan_json_output', { plan_id: planId }),
    getApplyDetails: (applyId) => call('get_apply_details', { apply_id: applyId }),
    getApplyLogs: (applyId) => call('get_apply_logs', { apply_id: applyId }),
    getWorkspaceDetails,
    listStateVersions,
    getStateVersion,
    getRunComments,
    searchProviderDocs: (o) =>
      call('search_provider_docs', {
        provider_name: o.providerName,
        provider_namespace: o.providerNamespace,
        service_slug: o.serviceSlug,
        provider_document_type: o.providerDocumentType,
        provider_version: o.providerVersion,
      }),
    getProviderDetails: (providerDocId) => call('get_provider_details', { provider_doc_id: providerDocId }),
    getLatestProviderVersion: (o) =>
      call('get_latest_provider_version', { namespace: o.namespace, name: o.name }),
    getProviderCapabilities: (o) =>
      call('get_provider_capabilities', { namespace: o.namespace, name: o.name, version: o.version }),
    tools,
    withObserver: (observer) => buildView(client, scope, opts, [...observers, observer]),
    close: () => client.close(),
  };
}
