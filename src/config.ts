export type Mode = 'live' | 'demo';

export const DEFAULT_MODELS = {
  agent: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
} as const;

export interface Config {
  mode: Mode;
  anthropicApiKey?: string;
  jevApiKey?: string;
  tfeOrg?: string;
  hasTfeToken: boolean;
  workspace: string;
  githubToken?: string;
  fixturesRepo: string;
  tfcWebhookSecret?: string;
  terraformMcpUrl: string;
  pollSeconds: number;
  models: { agent: string; fast: string };
  langfuse: { publicKey?: string; secretKey?: string; baseUrl?: string };
  databaseUrl: string;
}

type Env = Record<string, string | undefined>;

function str(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function int(env: Env, name: string, fallback: number): number {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const rawMode = str(env, 'RERUN_MODE') ?? 'live';
  if (rawMode !== 'live' && rawMode !== 'demo') {
    throw new Error(`RERUN_MODE must be "live" or "demo", got "${rawMode}"`);
  }
  return {
    mode: rawMode,
    anthropicApiKey: str(env, 'ANTHROPIC_API_KEY') ?? str(env, 'RERUN_ANTHROPIC_API_KEY'),
    jevApiKey: str(env, 'JEV_API_KEY'),
    tfeOrg: str(env, 'TFE_ORG'),
    // The app never uses TFE_TOKEN itself (it is passed to the MCP container); only presence is tracked.
    hasTfeToken: str(env, 'TFE_TOKEN') !== undefined,
    workspace: str(env, 'RERUN_WORKSPACE') ?? 'rerun-fixtures',
    githubToken: str(env, 'GITHUB_TOKEN'),
    fixturesRepo: str(env, 'RERUN_FIXTURES_REPO') ?? 'tayden-b/rerun-fixtures',
    tfcWebhookSecret: str(env, 'TFC_WEBHOOK_SECRET'),
    terraformMcpUrl: str(env, 'TERRAFORM_MCP_URL') ?? 'http://127.0.0.1:8080/mcp',
    pollSeconds: int(env, 'RERUN_POLL_SECONDS', 30),
    models: {
      agent: str(env, 'RERUN_MODEL_AGENT') ?? DEFAULT_MODELS.agent,
      fast: str(env, 'RERUN_MODEL_FAST') ?? DEFAULT_MODELS.fast,
    },
    langfuse: {
      publicKey: str(env, 'LANGFUSE_PUBLIC_KEY'),
      secretKey: str(env, 'LANGFUSE_SECRET_KEY'),
      baseUrl: str(env, 'LANGFUSE_BASE_URL'),
    },
    databaseUrl: str(env, 'DATABASE_URL') ?? 'file:data/rerun.db',
  };
}

export type LiveRequirement = 'anthropic' | 'jev' | 'tfe' | 'github';

const LIVE_CHECKS: Record<LiveRequirement, (c: Config) => string[]> = {
  anthropic: (c) => (c.anthropicApiKey ? [] : ['ANTHROPIC_API_KEY (or RERUN_ANTHROPIC_API_KEY)']),
  jev: (c) => (c.jevApiKey ? [] : ['JEV_API_KEY']),
  tfe: (c) => [...(c.hasTfeToken ? [] : ['TFE_TOKEN']), ...(c.tfeOrg ? [] : ['TFE_ORG'])],
  github: (c) => (c.githubToken ? [] : ['GITHUB_TOKEN']),
};

export class LiveConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `Rerun live mode is missing required environment variables: ${missing.join(', ')}. ` +
        'Set them (see .env.example) or run with RERUN_MODE=demo.',
    );
    this.name = 'LiveConfigError';
  }
}

/** Throws unless mode is live and every requested credential is present (default: all of them). */
export function requireLive(
  needs: LiveRequirement[] = ['anthropic', 'jev', 'tfe', 'github'],
  c: Config = config,
): Config {
  if (c.mode !== 'live') {
    throw new Error(`This code path needs RERUN_MODE=live (current mode: ${c.mode}).`);
  }
  const missing = needs.flatMap((need) => LIVE_CHECKS[need](c));
  if (missing.length > 0) throw new LiveConfigError(missing);
  return c;
}

export const config: Config = loadConfig();
