import { describe, expect, it } from 'vitest';
import { agentModel, fastModel } from './models';

describe('models', () => {
  it('refuses to build real models in demo mode', () => {
    expect(() => agentModel()).toThrow(/RERUN_MODE=live/);
    expect(() => fastModel()).toThrow(/RERUN_MODE=live/);
  });
});
