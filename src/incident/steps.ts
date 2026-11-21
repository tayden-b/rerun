import type { AgentEvent, AgentDeps } from '../agents/runtime';
import { runDiagnosis } from '../agents/diagnose';
import { runFix } from '../agents/fix';
import { triage } from '../agents/triage';
import { applyPatch, materializeRepo } from '../agents/workdir';
import type { Db } from '../db';
import { addArtifact, addDecision, appendEvent, getIncident, setStatus } from '../db/incidents';
import { route, selectAgents } from '../decisions/routing';
import { renderPrBody } from '../github/prBody';
import { collectRunArtifacts } from '../mcp/collect';
import type { TerraformMcp } from '../mcp/terraform';
import { redact } from '../shared/redact';
import type {
  Diagnosis,
  IncidentContext,
  IncidentStatus,
  Patch,
  PullRequest,
  Route,
  RunArtifacts,
  TriageResult,
  VerifyResult,
} from '../shared/types';
import { watchForNextRun } from '../watch/runs';
import { patchToDiff } from './diff';
import { incidentServices } from './services';
import { startIncident } from './start';
import { completedResult, enterStatus, getStatus, markCompleted, stepEvents, updateCost } from './store';

// SPEC §2 steps 1–8. Each takes only the incident id (plus the fix attempt) and reads what earlier steps
// produced from their stored results, so the workflow passes small values between steps. Each is
// idempotent per (incidentId, key): a completed step returns its stored result without side effects.

export interface CollectResult {
  scenario: string | null;
  artifacts: RunArtifacts;
}
export interface TriageStepResult {
  triage: TriageResult;
  route: Route;
}
export interface DiagnoseResult {
  diagnoses: Diagnosis[];
}
export interface FixResult {
  patch: Patch;
  headSha: string;
}
export interface ProposeResult {
  pr: PullRequest;
}
export interface ConfirmResult {
  nextRunId: string | null;
  nextStatus: string | null;
  childIncidentId: string | null;
}
export interface ApprovalRecord {
  approvedBy: string;
  mergeSha: string;
}

export const fixKey = (attempt: number) => (attempt === 1 ? 'fix' : `fix#${attempt}`);
export const verifyKey = (attempt: number) => (attempt === 1 ? 'verify' : `verify#${attempt}`);

const errorMessage = (error: unknown) => redact(error instanceof Error ? error.message : String(error));

async function once<T>(
  incidentId: string,
  key: string,
  step: string,
  status: IncidentStatus | null,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const db = await incidentServices().db();
  const stored = await completedResult<T>(db, incidentId, key);
  if (stored !== undefined) return stored;
  if (status) await enterStatus(db, incidentId, step, status);
  try {
    const result = await fn(db);
    await markCompleted(db, incidentId, step, key, result);
    return result;
  } catch (error) {
    await appendEvent(db, incidentId, { step, kind: 'error', title: errorMessage(error), payload: { key } });
    throw error;
  }
}

async function required<T>(db: Db, incidentId: string, key: string): Promise<T> {
  const value = await completedResult<T>(db, incidentId, key);
  if (value === undefined) throw new Error(`Incident ${incidentId}: step "${key}" has not completed`);
  return value;
}

async function incidentRow(db: Db, incidentId: string) {
  const incident = await getIncident(db, incidentId);
  if (!incident) throw new Error(`Unknown incident ${incidentId}`);
  return incident;
}

async function withMcp<T>(scenario: string | null, fn: (mcp: TerraformMcp) => Promise<T>): Promise<T> {
  const mcp = await incidentServices().mcp(scenario ?? undefined);
  try {
    return await fn(mcp);
  } finally {
    await mcp.close();
  }
}

/** Stores agent events, shaped the way the dashboard reads them (tool/args/ok, string model, usage.model). */
function agentEmitter(db: Db, incidentId: string): AgentDeps['emit'] {
  return async (event: AgentEvent) => {
    const raw = event.payload;
    const p: Record<string, unknown> | null =
      raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : null;
    if (p && (event.kind === 'tool_call' || event.kind === 'tool_result')) {
      p.tool = p.toolName;
      if (event.kind === 'tool_call') p.args = p.input;
      else p.ok = p.isError !== true;
    }
    if (p && event.kind === 'agent_step') {
      const model = p.model as { modelId?: unknown } | string | undefined;
      if (model && typeof model === 'object' && typeof model.modelId === 'string') p.model = model.modelId;
      if (p.done === true && typeof p.modelId === 'string') {
        p.model = p.modelId;
        p.usage = { ...(p.usage as object), model: p.modelId };
      }
    }
    await appendEvent(db, incidentId, {
      step: event.step,
      kind: event.kind,
      title: event.title,
      payload: p ?? raw,
    });
  };
}

async function context(
  db: Db,
  incidentId: string,
  withTriage: boolean,
  headSha = '',
): Promise<IncidentContext> {
  const incident = await incidentRow(db, incidentId);
  const { artifacts } = await required<CollectResult>(db, incidentId, 'collect');
  const triaged = withTriage ? await required<TriageStepResult>(db, incidentId, 'triage') : undefined;
  const repo = incidentServices().github((await scenarioOf(db, incidentId)) ?? undefined).repo;
  return {
    incidentId,
    runId: incident.runId,
    workspace: incident.workspace,
    artifacts,
    triage: triaged?.triage,
    repo: { ...repo, headSha },
  };
}

async function scenarioOf(db: Db, incidentId: string): Promise<string | null> {
  return (await required<CollectResult>(db, incidentId, 'collect')).scenario;
}

async function agentDeps(db: Db, incidentId: string, scenario: string | null, files: Record<string, string>) {
  const services = incidentServices();
  const mcp = await services.mcp(scenario ?? undefined);
  const deps: AgentDeps = {
    model: services.model(scenario ?? undefined),
    files,
    mcpTools: await mcp.tools(),
    emit: agentEmitter(db, incidentId),
  };
  return { deps, close: () => mcp.close() };
}

/** Step 1: run, logs, plan JSON and state through the Terraform MCP server. */
export function collectStep(incidentId: string, runId: string): Promise<CollectResult> {
  return once(incidentId, 'collect', 'collect', 'collecting', async (db) => {
    const scenario = incidentServices().scenarioFor(runId) ?? null;
    const artifacts = await withMcp(scenario, (mcp) =>
      collectRunArtifacts(mcp, runId, async (event) => {
        await appendEvent(db, incidentId, event);
      }),
    );
    if (artifacts.planLogs)
      await addArtifact(db, incidentId, { type: 'log', name: 'plan.log', content: artifacts.planLogs });
    if (artifacts.applyLogs) {
      await addArtifact(db, incidentId, { type: 'log', name: 'apply.log', content: artifacts.applyLogs });
    }
    if (artifacts.planJson !== undefined) {
      await addArtifact(db, incidentId, {
        type: 'plan_json',
        name: 'plan.json',
        content: JSON.stringify(artifacts.planJson),
      });
    }
    return { scenario, artifacts };
  });
}

/** Step 2: one Jev decision (four questions), persisted as a decisions row, then routing. */
export async function triageStep(incidentId: string): Promise<{ route: Route }> {
  const result = await once(incidentId, 'triage', 'triage', 'triaging', async (db) => {
    const services = incidentServices();
    const ctx = await context(db, incidentId, false);
    const provider = services.decisions((await scenarioOf(db, incidentId)) ?? undefined);
    const outcome = await triage(ctx, provider);
    await addDecision(db, incidentId, {
      provider: outcome.result.provider,
      request: outcome.request,
      response: outcome.response,
      inputTokens: outcome.response.inputTokens,
      latencyMs: outcome.response.latencyMs,
    });
    await appendEvent(db, incidentId, {
      step: 'triage',
      kind: 'decision',
      title: `${provider.name === 'jev' ? 'Jev' : provider.name} triage`,
      payload: outcome.result,
    });
    const chosen = route(outcome.result);
    await enterStatus(
      db,
      incidentId,
      'triage',
      'triaging',
      {
        failureClass: outcome.result.failureClass.choice,
        stage: outcome.result.stage,
        route: chosen,
        needsHuman: chosen === 'draftPr',
      },
      { route: chosen },
    );
    await updateCost(db, incidentId, services.config.models.fast);
    return { triage: outcome.result, route: chosen };
  });
  return { route: result.route };
}

/** Step 3: Config agent (always) and Reality agent (per `selectAgents`) in parallel. */
export async function diagnoseStep(incidentId: string): Promise<{ agents: number }> {
  const result = await once(incidentId, 'diagnose', 'diagnose', 'diagnosing', async (db) => {
    const services = incidentServices();
    const scenario = await scenarioOf(db, incidentId);
    const github = services.github(scenario ?? undefined);
    const snapshot = await github.getRepoSnapshot(github.repo.baseBranch);
    const ctx = await context(db, incidentId, true, snapshot.headSha);
    const which = selectAgents(ctx.triage!);
    const { deps, close } = await agentDeps(db, incidentId, scenario, snapshot.files);
    try {
      for (const agent of which) {
        await appendEvent(db, incidentId, {
          step: `diagnose:${agent}`,
          kind: 'agent_step',
          title: `${agent === 'config' ? 'Config' : 'Reality'} agent started`,
          payload: { agent, model: modelName(deps.model) },
        });
      }
      const diagnoses = await runDiagnosis(ctx, which, deps);
      for (const d of diagnoses) {
        await appendEvent(db, incidentId, {
          step: `diagnose:${d.agent}`,
          kind: 'artifact',
          title: 'Diagnosis',
          payload: d,
        });
      }
      await updateCost(db, incidentId, services.config.models.fast);
      return { diagnoses };
    } finally {
      await close();
    }
  });
  return { agents: result.diagnoses.length };
}

const modelName = (model: AgentDeps['model']) => (typeof model === 'string' ? model : model.modelId);

/** Step 4 (attempt 1) and the one retry after a failed verification (attempt 2). */
export async function fixStep(incidentId: string, attempt: number): Promise<{ files: number }> {
  const result = await once(incidentId, fixKey(attempt), 'fix', 'fixing', async (db) => {
    const services = incidentServices();
    const scenario = await scenarioOf(db, incidentId);
    const github = services.github(scenario ?? undefined);
    const snapshot = await github.getRepoSnapshot(github.repo.baseBranch);
    const ctx = await context(db, incidentId, true, snapshot.headSha);
    const { diagnoses } = await required<DiagnoseResult>(db, incidentId, 'diagnose');
    const previous =
      attempt > 1
        ? {
            verify: await required<VerifyResult>(db, incidentId, verifyKey(attempt - 1)),
            patch: (await required<FixResult>(db, incidentId, fixKey(attempt - 1))).patch,
          }
        : undefined;
    const { deps, close } = await agentDeps(db, incidentId, scenario, snapshot.files);
    try {
      await appendEvent(db, incidentId, {
        step: 'fix',
        kind: 'agent_step',
        title: attempt > 1 ? 'Fix agent retry with verifier output' : 'Fix agent started',
        payload: { model: modelName(deps.model), attempt },
      });
      const patch = await runFix(ctx, diagnoses, deps, previous?.verify, previous?.patch.files ?? []);
      await appendEvent(db, incidentId, {
        step: 'fix',
        kind: 'artifact',
        title: patch.title,
        payload: patch,
      });
      await addArtifact(db, incidentId, {
        type: 'diff',
        name: `fix-${attempt}.diff`,
        content: patchToDiff(patch.files),
      });
      await updateCost(db, incidentId, services.config.models.fast);
      return { patch, headSha: snapshot.headSha };
    } finally {
      await close();
    }
  });
  return { files: result.patch.files.length };
}

/** Step 5: fmt, validate and a speculative plan on the patched tree. */
export async function verifyStep(incidentId: string, attempt: number): Promise<{ ok: boolean }> {
  const result = await once(incidentId, verifyKey(attempt), 'verify', 'verifying', async (db) => {
    const services = incidentServices();
    const scenario = await scenarioOf(db, incidentId);
    const { patch, headSha } = await required<FixResult>(db, incidentId, fixKey(attempt));
    const snapshot = await services.github(scenario ?? undefined).getRepoSnapshot(headSha);
    const workdir = await materializeRepo({ files: applyPatch(snapshot.files, patch) });
    let verify: VerifyResult;
    try {
      verify = await services.verifier(scenario ?? undefined).verify(workdir.dir);
    } finally {
      await workdir.cleanup();
    }
    await appendEvent(db, incidentId, {
      step: 'verify',
      kind: 'artifact',
      title: verify.summary,
      payload: verify,
    });
    await addArtifact(db, incidentId, {
      type: 'verify_output',
      name: `verify-${attempt}.txt`,
      content: (['fmt', 'validate', 'plan'] as const)
        .map((s) => `$ terraform ${s} (exit ${verify[s].exitCode})\n${verify[s].stdout}${verify[s].stderr}`)
        .join('\n'),
    });
    return verify;
  });
  return { ok: result.ok };
}

/** Verification failed twice: stop and hand the incident to a human. */
export function giveUpStep(incidentId: string): Promise<null> {
  return once(incidentId, 'give_up', 'verify', null, async (db) => {
    await enterStatus(
      db,
      incidentId,
      'verify',
      'needs_human',
      { needsHuman: true },
      {
        reason: 'verification failed after one retry',
      },
    );
    return null;
  });
}

const isPullRequest = (p: unknown): p is PullRequest =>
  !!p &&
  typeof p === 'object' &&
  typeof (p as PullRequest).url === 'string' &&
  typeof (p as PullRequest).number === 'number';

/** Step 6: branch `rerun/fix-<runId>`, commit, PR (draft when routed `draftPr`). */
export async function proposeStep(incidentId: string): Promise<{ draft: boolean }> {
  const result = await once(incidentId, 'propose', 'propose', 'proposing', async (db) => {
    const services = incidentServices();
    const incident = await incidentRow(db, incidentId);
    const scenario = await scenarioOf(db, incidentId);
    const github = services.github(scenario ?? undefined);
    const triaged = await required<TriageStepResult>(db, incidentId, 'triage');
    const { diagnoses } = await required<DiagnoseResult>(db, incidentId, 'diagnose');
    const attempt = (await completedResult(db, incidentId, fixKey(2))) ? 2 : 1;
    const { patch, headSha } = await required<FixResult>(db, incidentId, fixKey(attempt));
    const verify = await required<VerifyResult>(db, incidentId, verifyKey(attempt));
    const draft = triaged.route === 'draftPr';

    // A retried step (crash after the PR was opened) reuses the PR it already recorded.
    const existing = (await stepEvents(db, incidentId, 'propose')).map((e) => e.payload).find(isPullRequest);
    let pr = existing;
    if (!pr) {
      const branch = `rerun/fix-${incident.runId}`;
      try {
        await github.createBranch(branch, headSha);
      } catch (error) {
        if (!/already exists/i.test(errorMessage(error))) throw error;
      }
      await github.commitFiles(branch, patch.files, `${patch.title}\n\nRerun incident ${incidentId}`);
      const org = services.config.tfeOrg ?? 'org';
      const body = renderPrBody({
        triage: triaged.triage,
        diagnoses,
        patch,
        verify,
        runUrl: `https://app.terraform.io/app/${org}/workspaces/${incident.workspace}/runs/${incident.runId}`,
        incidentUrl: services.incidentUrl(incidentId),
      });
      pr = await github.openPullRequest({ branch, title: patch.title, body, draft });
      await appendEvent(db, incidentId, {
        step: 'propose',
        kind: 'artifact',
        title: `PR #${pr.number}`,
        payload: pr,
      });
      await addArtifact(db, incidentId, { type: 'pr_body', name: `pr-${pr.number}.md`, content: body });
    }
    if (draft) {
      await enterStatus(
        db,
        incidentId,
        'propose',
        'needs_human',
        {
          prUrl: pr.url,
          prNumber: pr.number,
          needsHuman: true,
        },
        { draft: true },
      );
    } else {
      await setStatus(db, incidentId, 'proposing', { prUrl: pr.url, prNumber: pr.number });
    }
    return { pr };
  });
  return { draft: result.pr.draft };
}

/** Whether the approve route already merged the PR (the `await` step's completion record). */
export async function isApprovedStep(incidentId: string): Promise<boolean> {
  const db = await incidentServices().db();
  return (await completedResult<ApprovalRecord>(db, incidentId, 'await')) !== undefined;
}

/** Step 7 begins: the hook exists, so the dashboard may now approve. Draft PRs stay `needs_human`. */
export async function markAwaitingStep(incidentId: string): Promise<void> {
  const db = await incidentServices().db();
  if ((await getStatus(db, incidentId)) === 'proposing')
    await enterStatus(db, incidentId, 'await', 'awaiting_approval');
}

/** Step 8: the next run on the workspace decides `resolved`, or a linked new incident. */
export function confirmStep(incidentId: string): Promise<ConfirmResult> {
  return once(incidentId, 'confirm', 'confirm', 'confirming', async (db) => {
    const services = incidentServices();
    const incident = await incidentRow(db, incidentId);
    const scenario = await scenarioOf(db, incidentId);
    await appendEvent(db, incidentId, {
      step: 'confirm',
      kind: 'tool_call',
      title: 'list_runs',
      payload: { toolCallId: 'confirm-1', tool: 'list_runs', args: { afterRunId: incident.runId } },
    });
    let next: { runId: string; status: string };
    try {
      next = await withMcp(scenario, (mcp) =>
        watchForNextRun(services.runLister(mcp, incident.runId), {
          afterRunId: incident.runId,
          ...services.watch,
        }),
      );
    } catch (error) {
      await enterStatus(
        db,
        incidentId,
        'confirm',
        'needs_human',
        { needsHuman: true },
        { reason: errorMessage(error) },
      );
      return { nextRunId: null, nextStatus: null, childIncidentId: null };
    }
    await appendEvent(db, incidentId, {
      step: 'confirm',
      kind: 'tool_result',
      title: 'list_runs',
      payload: {
        toolCallId: 'confirm-1',
        tool: 'list_runs',
        ok: true,
        output: { id: next.runId, status: next.status },
      },
    });
    if (next.status === 'applied') {
      await enterStatus(db, incidentId, 'confirm', 'resolved', undefined, { nextRunId: next.runId });
      return { nextRunId: next.runId, nextStatus: next.status, childIncidentId: null };
    }
    let childIncidentId: string | null = null;
    if (next.status === 'errored') {
      childIncidentId = (await startIncident(next.runId, { parentIncidentId: incidentId })).incident.id;
    }
    await enterStatus(
      db,
      incidentId,
      'confirm',
      'needs_human',
      { needsHuman: true },
      {
        nextRunId: next.runId,
        nextStatus: next.status,
        childIncidentId,
      },
    );
    return { nextRunId: next.runId, nextStatus: next.status, childIncidentId };
  });
}

/** An unrecoverable step error: the incident is `failed` with the message in the Trace. */
export async function failStep(incidentId: string, step: string, message: string): Promise<void> {
  const db = await incidentServices().db();
  await appendEvent(db, incidentId, { step, kind: 'error', title: redact(message), payload: null });
  await enterStatus(db, incidentId, step, 'failed');
}
