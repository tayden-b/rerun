import type { Metadata } from 'next';
import { ArrowDownIcon, ArrowRightIcon } from 'lucide-react';
import { REGISTRY_TOOLS, TERRAFORM_TOOLS } from '@/src/mcp/allowlist';
import { config } from '@/src/config';
import { TOOL_PURPOSES } from '@/lib/ui/tools';

export const metadata: Metadata = { title: 'About · Rerun' };

const TRIGGER = [
  {
    name: 'Poller / webhook',
    detail: `list_runs every ${config.pollSeconds}s, or an HCP Terraform notification`,
  },
  { name: 'Incident workflow', detail: 'Durable workflow; every step writes an event' },
  { name: 'Terraform MCP server', detail: 'Read-only, allowlisted tools, one workspace' },
  { name: 'HCP Terraform', detail: 'Runs, plans, applies, logs and state' },
];

const PIPELINE = [
  { name: 'Jev triage', detail: 'Failure class, stage, fixability, blast radius' },
  { name: 'Config · Reality agents', detail: 'Diagnose the code and the live state in parallel' },
  { name: 'Fix agent', detail: 'Smallest patch to the working copy' },
  { name: 'Docker verifier', detail: 'fmt, validate, speculative plan' },
  { name: 'GitHub PR', detail: 'Branch, commit, evidence in the PR body' },
  { name: 'Dashboard', detail: 'A human reviews and approves the merge' },
];

const STEPS = [
  ['collect', 'Read the failed run, its logs, plan, apply and latest state through MCP.'],
  ['triage', 'One Jev request answers four questions; each answer is shown as probability bars.'],
  ['diagnose', 'The failure class picks which agents run; their tool calls appear in the trace.'],
  ['fix', 'The fix agent edits files in the fixture repository and explains each change.'],
  [
    'verify',
    'The patch must pass a speculative plan. One retry with the verifier output, then a human takes over.',
  ],
  ['propose', 'A PR is opened, ready for review or as a draft depending on the triage route.'],
  ['confirm', 'After Approve the PR merges; the next run on the workspace resolves or reopens the incident.'],
] as const;

export default function AboutPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl content-start gap-8 px-6 pt-8 pb-12">
      <header className="grid max-w-3xl gap-2">
        <h1 className="text-xl font-semibold tracking-tight">About Rerun</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Rerun watches one HCP Terraform workspace. When a run errors it reads the failure through the
          Terraform MCP server, triages it, writes the smallest fix, proves the fix with a speculative plan
          and opens a pull request. Every step is recorded here so a person can review the evidence and
          approve the merge.
        </p>
      </header>

      <section aria-labelledby="architecture" className="grid gap-3">
        <h2 id="architecture" className="text-sm font-medium">
          Architecture
        </h2>
        <div className="bg-card grid gap-4 rounded-lg border p-4" data-testid="architecture">
          <Flow nodes={TRIGGER} />
          <div className="text-muted-foreground flex items-center gap-2 pl-4 text-xs">
            <ArrowDownIcon className="size-4" aria-hidden="true" />
            The workflow runs these steps for each incident
          </div>
          <Flow nodes={PIPELINE} />
        </div>
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="flow" className="grid gap-3">
          <h2 id="flow" className="text-sm font-medium">
            Incident flow
          </h2>
          <ol className="bg-card divide-y rounded-lg border">
            {STEPS.map(([step, text], i) => (
              <li key={step} className="grid grid-cols-[1.5rem_5rem_1fr] gap-2 px-4 py-3 text-sm">
                <span className="text-muted-foreground font-mono text-xs leading-5 tabular-nums">
                  {i + 1}
                </span>
                <span className="font-mono text-xs leading-5">{step}</span>
                <span className="text-muted-foreground">{text}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground text-sm leading-relaxed">
            In demo mode (<span className="font-mono text-xs">RERUN_MODE=demo</span>) the MCP server, Jev,
            GitHub and the verifier are replaced by recorded fixtures, so the dashboard works without
            credentials.
          </p>
        </section>

        <section aria-labelledby="tools" className="grid gap-3">
          <h2 id="tools" className="text-sm font-medium">
            MCP tools{' '}
            <span className="text-muted-foreground font-normal">
              {TERRAFORM_TOOLS.length + REGISTRY_TOOLS.length}
            </span>
          </h2>
          <div className="bg-card rounded-lg border" data-testid="mcp-tools">
            <ToolGroup title="HCP Terraform" tools={TERRAFORM_TOOLS} />
            <ToolGroup title="Terraform Registry" tools={REGISTRY_TOOLS} />
          </div>
          <p className="text-muted-foreground text-sm">
            Rerun refuses any other tool and any workspace except{' '}
            <span className="text-foreground font-mono text-xs">{config.workspace}</span>.
          </p>
        </section>
      </div>
    </main>
  );
}

function Flow({ nodes }: { nodes: readonly { name: string; detail: string }[] }) {
  return (
    <ol className="flex items-stretch gap-2">
      {nodes.map((node, i) => (
        <li key={node.name} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="bg-background grid h-full min-w-0 flex-1 content-start gap-1 rounded-md border px-3 py-2">
            <span className="text-sm font-medium">{node.name}</span>
            <span className="text-muted-foreground text-xs leading-snug">{node.detail}</span>
          </div>
          {i < nodes.length - 1 && (
            <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

function ToolGroup({ title, tools }: { title: string; tools: readonly (keyof typeof TOOL_PURPOSES)[] }) {
  return (
    <div className="border-b last:border-b-0">
      <h3 className="text-muted-foreground px-4 pt-3 pb-1 text-xs">{title}</h3>
      <ul>
        {tools.map((tool) => (
          <li
            key={tool}
            className="grid grid-cols-[13rem_1fr] gap-2 px-4 py-2 text-sm"
            data-testid="mcp-tool"
          >
            <span className="font-mono text-xs leading-5">{tool}</span>
            <span className="text-muted-foreground">{TOOL_PURPOSES[tool]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
