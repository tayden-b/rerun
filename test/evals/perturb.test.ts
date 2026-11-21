import { describe, expect, it } from 'vitest';
import { findResources, perturbState, perturbingProvider } from '../../evals/perturb';
import { keywordProvider, sampleState } from './fakes';

describe('perturbState', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(perturbState(sampleState, 7)).toEqual(perturbState(sampleState, 7));
    expect(perturbState(sampleState, 7).state).not.toEqual(perturbState(sampleState, 8).state);
  });

  it('does not mutate its input', () => {
    const before = structuredClone(sampleState);
    perturbState(sampleState, 1);
    expect(sampleState).toEqual(before);
  });

  it('finds resource addresses but not file names or hosts', () => {
    expect(findResources(sampleState).map((r) => `${r.type}.${r.name}`)).toEqual([
      'random_pet.service',
      'terraform_data.bootstrap',
      'tls_private_key.ca',
    ]);
  });

  it('renames resources consistently across every state field', () => {
    const { state, renames } = perturbState(sampleState, 3);
    const s = state as typeof sampleState;
    expect(Object.keys(renames).sort()).toEqual([
      'random_pet.service',
      'terraform_data.bootstrap',
      'tls_private_key.ca',
    ]);
    const text = JSON.stringify(s);
    for (const [from, to] of Object.entries(renames)) {
      expect(text).not.toMatch(new RegExp(`${from.replace('.', '\\.')}(?![A-Za-z0-9_-])`));
      expect(s.planSummary.resources.map((r) => r.address)).toContain(to);
    }
    const boot = renames['terraform_data.bootstrap'];
    const bootName = boot.split('.')[1];
    expect(s.errorExcerpt).toContain(`with ${boot},`);
    expect(s.errorExcerpt).toContain(`in resource "terraform_data" "${bootName}"`);
    expect(s.errorExcerpt).toContain(`${renames['random_pet.service']}.id`);
    expect(s.errorExcerpt).toContain('main.tf line 58');
  });

  it('preserves class semantics: same counts, files, run status and error lines', () => {
    const { state, uuid } = perturbState(sampleState, 11);
    const s = state as typeof sampleState;
    expect(s.runStatus).toBe(sampleState.runStatus);
    expect(s.stage).toBe(sampleState.stage);
    expect(s.planSummary.counts).toEqual(sampleState.planSummary.counts);
    expect([...s.changedFiles].sort()).toEqual([...sampleState.changedFiles].sort());
    expect(s.planSummary.resources).toHaveLength(3);
    expect(s.errorExcerpt).toContain('Error: local-exec provisioner error');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(s.errorExcerpt).toContain(`# request-id ${uuid}`);
  });

  it('reorders plan entries for some seed', () => {
    const order = (seed: number) =>
      (perturbState(sampleState, seed, ['reorder']).state as typeof sampleState).planSummary.resources.map(
        (r) => r.address,
      );
    const seen = new Set(Array.from({ length: 10 }, (_, i) => order(i).join(',')));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('never reorders scalar arrays such as replacement actions', () => {
    const state = {
      planSummary: {
        resources: [
          { address: 'random_pet.a', actions: ['delete', 'create'] },
          { address: 'random_pet.b', actions: ['no-op'] },
        ],
      },
    };
    for (let seed = 0; seed < 20; seed++) {
      const out = perturbState(state, seed, ['reorder']).state as typeof state;
      expect(out.planSummary.resources.find((r) => r.address === 'random_pet.a')?.actions).toEqual([
        'delete',
        'create',
      ]);
    }
  });

  it('perturbingProvider passes the perturbed state to the inner provider', async () => {
    const inner = keywordProvider();
    await perturbingProvider(inner, 5).decide(sampleState, {});
    expect(inner.states[0]).toEqual(perturbState(sampleState, 5).state);
  });
});
