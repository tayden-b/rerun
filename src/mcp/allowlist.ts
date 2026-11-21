/** SPEC §5: the only Terraform MCP tools Rerun may call. */
export const TERRAFORM_TOOLS = [
  'list_workspaces',
  'get_workspace_details',
  'list_runs',
  'get_run_details',
  'get_plan_details',
  'get_plan_logs',
  'get_plan_json_output',
  'get_apply_details',
  'get_apply_logs',
  'list_state_versions',
  'get_state_version',
  'get_run_comments',
  'whoami',
] as const;

export const REGISTRY_TOOLS = [
  'search_provider_docs',
  'get_provider_details',
  'get_latest_provider_version',
  'get_provider_capabilities',
] as const;

export const ALLOWED_TOOLS = [...TERRAFORM_TOOLS, ...REGISTRY_TOOLS] as const;
export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export function isAllowedTool(name: string): name is AllowedTool {
  return (ALLOWED_TOOLS as readonly string[]).includes(name);
}
