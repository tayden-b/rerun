import { describe, expect, it, vi } from 'vitest';
import { buildTriageState, triage } from '../../src/agents/triage';
import { DecisionError } from '../../src/decisions/errors';
import { buildJevRequest, JEV_URL, JevDecisionProvider, parseJevResponse } from '../../src/decisions/jev';
import { FAILURE_CLASSES, TRIAGE_QUESTIONS } from '../../src/decisions/questions';
import { jevResponse, jsonResponse, sampleContext } from './fixtures';

function provider(...responses: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  const retryDelayMs = vi.fn(() => 0);
  return { fetch, retryDelayMs, jev: new JevDecisionProvider({ apiKey: 'test-key', fetch, retryDelayMs }) };
}

describe('Jev request mapping', () => {
  const body = buildJevRequest(buildTriageState(sampleContext()), TRIAGE_QUESTIONS);

  it('matches the SPEC §4 request', () => {
    expect(body).toMatchSnapshot();
  });

  it('uses the criteria shape required by each question type', () => {
    expect(body.model).toBe('jev-latest');
    expect(Object.keys(body.questions)).toEqual([
      'failure_class',
      'config_fixable',
      'blast_radius',
      'needs_human',
    ]);
    const fc = body.questions.failure_class;
    expect(fc.type).toBe('choice');
    expect(Array.isArray(fc.criteria)).toBe(false);
    expect(Object.keys(fc.criteria ?? {})).toEqual(FAILURE_CLASSES);
    expect(FAILURE_CLASSES).toHaveLength(12);
    expect(body.questions.blast_radius).toMatchObject({ type: 'score' });
    expect(body.questions.blast_radius.criteria).toHaveLength(4);
    expect(Array.isArray(body.questions.blast_radius.criteria)).toBe(true);
    expect(body.questions.config_fixable).toEqual({ type: 'noul', instructions: expect.any(String) });
    expect(body.questions.needs_human.criteria).toBeUndefined();
  });

  it('rejects questions whose criteria do not fit their type', () => {
    expect(() => buildJevRequest('s', { q: { type: 'choice', instructions: 'x', criteria: ['a'] } })).toThrow(
      DecisionError,
    );
    expect(() =>
      buildJevRequest('s', { q: { type: 'score', instructions: 'x', criteria: { a: 'b' } } }),
    ).toThrow(DecisionError);
    expect(() => buildJevRequest('s', {})).toThrow(DecisionError);
  });
});

describe('JevDecisionProvider', () => {
  it('posts the body with the bearer key and maps a valid response to a TriageResult', async () => {
    const { fetch, jev } = provider(jsonResponse(jevResponse()));
    const { result, response } = await triage(sampleContext(), jev);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string).questions.failure_class.type).toBe('choice');

    expect(result).toMatchObject({
      failureClass: { choice: 'apply_runtime', confidence: 0.9 },
      configFixable: { noul: 0.85 },
      blastRadius: { score: 0.1, legend: { '0': 'Nothing is destroyed or replaced' } },
      needsHuman: { noul: 0.2 },
      stage: 'apply',
      provider: 'jev',
      inputTokens: 1053,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.failureClass).not.toHaveProperty('type');
    expect(response.inputTokens).toBe(1053);
  });

  it('throws DecisionError on a malformed response', async () => {
    const { jev } = provider(jsonResponse({ answers: {} }));
    await expect(jev.decide('s', TRIAGE_QUESTIONS)).rejects.toThrow(/Malformed Jev response/);
  });

  it('throws DecisionError when an answer is missing or has the wrong type', () => {
    const missing = jevResponse();
    delete (missing.answers as Record<string, unknown>).needs_human;
    expect(() => parseJevResponse(missing, TRIAGE_QUESTIONS)).toThrow(/no answer for "needs_human"/);
    const wrong = jevResponse({
      config_fixable: { type: 'score', score: 1, confidence: 1, probabilities: {}, legend: {} },
    });
    expect(() => parseJevResponse(wrong, TRIAGE_QUESTIONS)).toThrow(/expected noul/);
  });

  it('rejects a failure_class outside the FailureClass enum', async () => {
    const bad = jevResponse({
      failure_class: {
        type: 'choice',
        choice: 'cosmic_rays',
        confidence: 1,
        probabilities: { cosmic_rays: 1 },
      },
    });
    const { jev } = provider(jsonResponse(bad));
    await expect(triage(sampleContext(), jev)).rejects.toThrow(/not a FailureClass/);
  });

  it('surfaces the API message on 400 without retrying', async () => {
    const { fetch, jev } = provider(jsonResponse({ detail: 'state exceeds the token limit' }, 400));
    const err = await jev.decide('s', TRIAGE_QUESTIONS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DecisionError);
    expect((err as DecisionError).message).toMatch(/\(400\): state exceeds the token limit/);
    expect((err as DecisionError).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces 422 validation details', async () => {
    const { jev } = provider(
      jsonResponse({ detail: [{ loc: ['body', 'state'], msg: 'Field required', type: 'missing' }] }, 422),
    );
    await expect(jev.decide('s', TRIAGE_QUESTIONS)).rejects.toThrow(/\(422\): body\.state: Field required/);
  });

  it('retries once on 5xx and 429, passing Retry-After to the jittered delay', async () => {
    const five = provider(jsonResponse({}, 503), jsonResponse(jevResponse()));
    await expect(five.jev.decide('s', TRIAGE_QUESTIONS)).resolves.toMatchObject({ inputTokens: 1053 });
    expect(five.fetch).toHaveBeenCalledTimes(2);

    const limited = provider(jsonResponse({}, 429, { 'retry-after': '2' }), jsonResponse(jevResponse()));
    await limited.jev.decide('s', TRIAGE_QUESTIONS);
    expect(limited.retryDelayMs).toHaveBeenCalledWith('2');
  });

  it('gives up after one retry', async () => {
    const { fetch, jev } = provider(jsonResponse({}, 500), jsonResponse({ detail: 'overloaded' }, 502));
    await expect(jev.decide('s', TRIAGE_QUESTIONS)).rejects.toThrow(/\(502\): overloaded/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once on a network error', async () => {
    const { fetch, jev } = provider(new TypeError('fetch failed'), jsonResponse(jevResponse()));
    await expect(jev.decide('s', TRIAGE_QUESTIONS)).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('needs JEV_API_KEY in live mode when no key is passed', () => {
    expect(() => new JevDecisionProvider()).toThrow(/RERUN_MODE=live/);
  });
});
