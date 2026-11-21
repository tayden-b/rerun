import { describe, expect, it } from 'vitest';
import { LiveConfigError, loadConfig, requireLive } from './config';

describe('loadConfig', () => {
  it('applies SPEC §9 defaults', () => {
    const c = loadConfig({});
    expect(c.mode).toBe('live');
    expect(c.workspace).toBe('rerun-fixtures');
    expect(c.fixturesRepo).toBe('tayden-b/rerun-fixtures');
    expect(c.terraformMcpUrl).toBe('http://127.0.0.1:8080/mcp');
    expect(c.pollSeconds).toBe(30);
    expect(c.models).toEqual({ agent: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' });
    expect(c.databaseUrl).toBe('file:data/rerun.db');
  });

  it('accepts RERUN_ANTHROPIC_API_KEY as an alias, preferring ANTHROPIC_API_KEY', () => {
    expect(loadConfig({ RERUN_ANTHROPIC_API_KEY: 'alias' }).anthropicApiKey).toBe('alias');
    expect(
      loadConfig({ RERUN_ANTHROPIC_API_KEY: 'alias', ANTHROPIC_API_KEY: 'direct' }).anthropicApiKey,
    ).toBe('direct');
  });

  it('parses demo mode and rejects unknown modes', () => {
    expect(loadConfig({ RERUN_MODE: 'demo' }).mode).toBe('demo');
    expect(() => loadConfig({ RERUN_MODE: 'prod' })).toThrow(/RERUN_MODE/);
  });

  it('allows RERUN_POLL_SECONDS=0 and rejects garbage', () => {
    expect(loadConfig({ RERUN_POLL_SECONDS: '0' }).pollSeconds).toBe(0);
    expect(() => loadConfig({ RERUN_POLL_SECONDS: 'soon' })).toThrow(/RERUN_POLL_SECONDS/);
  });
});

describe('requireLive', () => {
  it('lists every missing variable', () => {
    try {
      requireLive(undefined, loadConfig({}));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LiveConfigError);
      expect((err as LiveConfigError).missing).toEqual([
        'ANTHROPIC_API_KEY (or RERUN_ANTHROPIC_API_KEY)',
        'JEV_API_KEY',
        'TFE_ORG',
        'GITHUB_TOKEN',
      ]);
    }
  });

  it('checks only the requested credentials', () => {
    const c = loadConfig({ RERUN_ANTHROPIC_API_KEY: 'x' });
    expect(requireLive(['anthropic'], c)).toBe(c);
  });

  it('refuses in demo mode', () => {
    expect(() => requireLive([], loadConfig({ RERUN_MODE: 'demo' }))).toThrow(/RERUN_MODE=live/);
  });
});
