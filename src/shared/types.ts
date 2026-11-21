export type FailureClass = 'config_syntax' | 'config_reference' | 'missing_input' | 'provider_version' | 'provider_auth'
  | 'provider_api_error' | 'apply_runtime' | 'precondition_failed' | 'module_source' | 'dependency_cycle' | 'drift' | 'unknown';
export type Stage = 'init' | 'plan' | 'apply';
export type Route = 'autoPr' | 'draftPr';
export type IncidentStatus = 'collecting' | 'triaging' | 'diagnosing' | 'fixing' | 'verifying' | 'proposing'
  | 'awaiting_approval' | 'merged' | 'confirming' | 'resolved' | 'needs_human' | 'failed';

export interface RunArtifacts {
  run: unknown;                 // get_run_details result (raw)
  workspace: unknown;           // get_workspace_details result (raw)
  planLogs?: string; planJson?: unknown; applyLogs?: string; stateVersion?: unknown;
  stage: Stage; errorExcerpt: string;
}
export interface IncidentContext { incidentId: string; runId: string; workspace: string; artifacts: RunArtifacts; triage?: TriageResult; repo: { owner: string; name: string; baseBranch: string; headSha: string }; }

export interface ChoiceAnswer { choice: string; confidence: number; probabilities: Record<string, number> }
export interface NoulAnswer { noul: number }
export interface ScoreAnswer { score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> }
export interface TriageResult {
  failureClass: ChoiceAnswer & { choice: FailureClass };
  configFixable: NoulAnswer; blastRadius: ScoreAnswer; needsHuman: NoulAnswer;
  stage: Stage; errorExcerpt: string; provider: 'jev' | 'llm' | 'recorded'; inputTokens: number; latencyMs: number;
}
export interface DecisionQuestion { type: 'choice' | 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[] }
export interface DecisionProvider {
  readonly name: 'jev' | 'llm' | 'recorded';
  decide(state: unknown, questions: Record<string, DecisionQuestion>): Promise<{ answers: Record<string, ChoiceAnswer | NoulAnswer | ScoreAnswer>; inputTokens: number; latencyMs: number }>;
}

export interface EvidenceRef { kind: 'log' | 'plan' | 'state' | 'file' | 'docs'; ref: string; excerpt: string }
export interface Diagnosis { agent: 'config' | 'reality'; rootCause: string; evidence: EvidenceRef[]; suggestedChange: string; confidence: number; steps: number }
export interface PatchFile { path: string; before: string | null; after: string; rationale: string }
export interface Patch { files: PatchFile[]; title: string; summary: string }
export interface VerifyResult { ok: boolean; fmt: StepOutput; validate: StepOutput; plan: StepOutput; summary: string }
export interface StepOutput { ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }
export interface PullRequest { number: number; url: string; branch: string; draft: boolean }

export interface Verifier { readonly name: 'docker' | 'vercel-sandbox' | 'fake'; verify(workdir: string): Promise<VerifyResult> }
export interface IncidentEvent { incidentId: string; seq: number; at: string; step: string; kind: 'tool_call' | 'tool_result' | 'decision' | 'agent_step' | 'artifact' | 'status' | 'error'; title: string; payload: unknown }
