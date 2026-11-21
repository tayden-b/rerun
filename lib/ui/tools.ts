import type { AllowedTool } from '@/src/mcp/allowlist';

/** One-line purpose of each allowlisted Terraform MCP tool, as Rerun uses it. */
export const TOOL_PURPOSES: Record<AllowedTool, string> = {
  list_workspaces: 'Lists workspaces, filtered to the watched one.',
  get_workspace_details: 'Reads workspace settings, Terraform version and VCS repository.',
  list_runs: 'Polls the workspace for errored runs and the run after a merge.',
  get_run_details: 'Reads the failed run: status, message, plan and apply ids.',
  get_plan_details: 'Reads plan status and resource counts.',
  get_plan_logs: 'Fetches the plan log the error excerpt is built from.',
  get_plan_json_output: 'Reads the structured plan when one was produced.',
  get_apply_details: 'Reads apply status when the apply ran.',
  get_apply_logs: 'Fetches the apply log for runtime failures.',
  list_state_versions: 'Finds the latest state version of the workspace.',
  get_state_version: 'Reads current state so agents can compare config with reality.',
  get_run_comments: 'Reads comments left on the run.',
  whoami: 'Confirms which HCP Terraform identity the MCP server uses.',
  search_provider_docs: 'Searches provider documentation for the fix agent.',
  get_provider_details: 'Reads one provider documentation page.',
  get_latest_provider_version: 'Looks up the newest provider version for version failures.',
  get_provider_capabilities: 'Lists what a provider version supports.',
};
