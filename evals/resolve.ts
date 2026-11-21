/**
 * Takes one live scenario all the way (SPEC §2): break → incident → `POST /api/incidents/<id>/approve`
 * → PR merged → the fixtures repo's Actions apply → the next run `applied` → incident `resolved`.
 * Prints the phase timings as JSON. Needs the app running (`npm run dev`) and the live keys.
 *
 *   npx tsx evals/resolve.ts apply-time-exit-1
 *
 * Leaves the fix merged on the fixtures repo; run its `scripts/reset.sh` afterwards.
 */
import { getIncident, type IncidentDetail } from '../src/db/incidents';
import { incidentServices } from '../src/incident/services';
import { startIncidentViaApp } from './live';
import { fixturesDriver } from './liveFixtures';

const POLL_MS = 5_000;

async function main(scenario: string): Promise<void> {
  const services = incidentServices();
  const appUrl = process.env.RERUN_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const log = (line: string) => console.error(`resolve ${scenario}: ${line}`);
  const fixtures = fixturesDriver({ dir: process.env.RERUN_FIXTURES_DIR, mcp: () => services.mcp(), log });
  const load = async (id: string) => getIncident(await services.db(), id);
  const until = async (id: string, statuses: string[], timeoutMs: number): Promise<IncidentDetail> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const d = await load(id);
      if (d && statuses.includes(d.status)) return d;
      if (Date.now() > deadline) throw new Error(`${id}: still ${d?.status} after ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };

  const marks: Record<string, string> = { breakPushed: new Date().toISOString() };
  const runId = await fixtures.break(scenario);
  marks.erroredRunSeen = new Date().toISOString();
  const { incident } = await startIncidentViaApp(appUrl, runId);
  const ready = await until(incident.id, ['awaiting_approval', 'needs_human', 'failed'], 20 * 60_000);
  if (ready.status === 'failed') throw new Error(`${incident.id} failed before approval`);
  marks.prOpened = new Date().toISOString();
  log(`${ready.status}, ${ready.prUrl}; approving`);

  const res = await fetch(new URL(`/api/incidents/${incident.id}/approve`, appUrl), { method: 'POST' });
  if (!res.ok) throw new Error(`approve: HTTP ${res.status} ${await res.text()}`);
  marks.merged = new Date().toISOString();
  const done = await until(incident.id, ['resolved', 'failed', 'needs_human'], 45 * 60_000);
  marks.settled = new Date().toISOString();

  const statusAt = Object.fromEntries(
    done.events
      .filter((e) => e.kind === 'status' && typeof (e.payload as { status?: unknown })?.status === 'string')
      .map((e) => [(e.payload as { status: string }).status, e.at]),
  );
  const confirm = done.events.find((e) => (e.payload as { completed?: unknown })?.completed === 'confirm');
  const ms = (a?: string, b?: string) => (a && b ? Date.parse(b) - Date.parse(a) : null);
  console.log(
    JSON.stringify(
      {
        scenario,
        runId,
        incidentId: done.id,
        status: done.status,
        prUrl: done.prUrl,
        nextRun: (confirm?.payload as { result?: unknown })?.result ?? null,
        marks,
        statusAt,
        phasesMs: {
          breakToErroredRun: ms(marks.breakPushed, marks.erroredRunSeen),
          incidentToPr: ms(done.createdAt, statusAt.awaiting_approval ?? statusAt.needs_human),
          approveToMerged: ms(marks.prOpened, marks.merged),
          mergedToConfirming: ms(statusAt.merged, statusAt.confirming),
          confirmingToResolved: ms(statusAt.confirming, statusAt.resolved),
          total: ms(marks.breakPushed, marks.settled),
        },
      },
      null,
      2,
    ),
  );
  if (done.status !== 'resolved') process.exitCode = 1;
}

await main(process.argv[2] ?? 'apply-time-exit-1');
