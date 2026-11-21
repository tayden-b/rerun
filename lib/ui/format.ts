export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatPercent(p: number): string {
  return `${Math.round(clamp01(p) * 100)}%`;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export const DEFAULT_TFE_ORG = 'hashi-org-TF';

export function runUrl(org: string, workspace: string, runId: string): string {
  return `https://app.terraform.io/app/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/runs/${encodeURIComponent(runId)}`;
}

/** `#12` for a GitHub PR URL, else the URL's path tail. */
export function prLabel(prUrl: string, prNumber?: number | null): string {
  if (prNumber) return `#${prNumber}`;
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? `#${match[1]}` : prUrl;
}
