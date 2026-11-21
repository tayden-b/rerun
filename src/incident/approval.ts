import { appendEvent, getIncident } from '../db/incidents';
import { redact } from '../shared/redact';
import type { IncidentStatus } from '../shared/types';
import { incidentServices } from './services';
import type { ApprovalRecord, CollectResult, ProposeResult } from './steps';
import { completedResult, enterStatus, markCompleted } from './store';

export class IncidentActionError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'IncidentActionError';
  }
}

const DECIDABLE: IncidentStatus[] = ['awaiting_approval', 'needs_human'];

async function decidable(incidentId: string, allowed: IncidentStatus[] = DECIDABLE) {
  const services = incidentServices();
  const db = await services.db();
  const incident = await getIncident(db, incidentId);
  if (!incident) throw new IncidentActionError(404, `Unknown incident ${incidentId}`);
  if (!allowed.includes(incident.status as IncidentStatus)) {
    throw new IncidentActionError(
      409,
      `Incident is ${incident.status}; expected awaiting_approval or needs_human`,
    );
  }
  const proposed = await completedResult<ProposeResult>(db, incidentId, 'propose');
  if (!proposed || incident.prNumber === null)
    throw new IncidentActionError(409, 'Incident has no open pull request');
  const collected = await completedResult<CollectResult>(db, incidentId, 'collect');
  const github = services.github(collected?.scenario ?? undefined);
  return { services, db, incident, pr: proposed.pr, github };
}

/** Approve (SPEC §2 step 7): mark a draft ready, squash-merge, `merged`, then resume the workflow. */
export async function approveIncident(incidentId: string, approvedBy = 'dashboard') {
  const { services, db, pr, github } = await decidable(incidentId, [...DECIDABLE, 'merged']);
  // `merged` is accepted only to retry resuming the workflow after a failed delivery; it never re-merges.
  let record = await completedResult<ApprovalRecord>(db, incidentId, 'await');
  if (!record) {
    // Taken before the merge call: the merge-triggered run can be created before it returns.
    const approvedAt = new Date().toISOString();
    if (pr.draft) await github.markReadyForReview(pr.number);
    const merge = await github.mergePullRequest(pr.number, { method: 'squash' });
    if (!merge.merged) throw new IncidentActionError(409, `Pull request #${pr.number} was not merged`);
    record = { approvedBy, mergeSha: merge.sha, approvedAt };
    await enterStatus(db, incidentId, 'await', 'merged', undefined, { ...record, prNumber: pr.number });
    await markCompleted(db, incidentId, 'await', 'await', record);
  } else if (
    (await getIncident(db, incidentId))?.status !== 'merged' ||
    (await completedResult(db, incidentId, 'await_resumed')) !== undefined
  ) {
    throw new IncidentActionError(409, 'Incident was already approved');
  }
  const merge = { sha: record.mergeSha };
  const resumed = await services.resumeApproval(incidentId, record);
  if (resumed) await markCompleted(db, incidentId, 'await', 'await_resumed', true);
  else {
    await appendEvent(db, incidentId, {
      step: 'await',
      kind: 'error',
      title: 'No workflow is waiting on this incident; merged without confirmation',
      payload: null,
    });
  }
  return { status: 'merged' as const, merged: true, sha: merge.sha, resumed };
}

/** Request changes: comment on the PR and hand the incident to a human. */
export async function requestChanges(incidentId: string, comment: string | undefined) {
  const { db, pr, github } = await decidable(incidentId);
  const text = comment?.trim() ? redact(comment.trim()) : undefined;
  const body = text
    ? `**Changes requested** from the Rerun dashboard:\n\n${text}`
    : '**Changes requested** from the Rerun dashboard.';
  const posted = await github.commentOnPullRequest(pr.number, body);
  await enterStatus(
    db,
    incidentId,
    'await',
    'needs_human',
    { needsHuman: true },
    {
      comment: text ?? null,
      commentUrl: posted.url,
    },
  );
  return { status: 'needs_human' as const, commentUrl: posted.url };
}
