import type { StepResult, ToolExecutionOptions, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { artifactTools, grepLogs, logTools, providerDocTools } from '../../src/agents/tools/artifacts';
import { compact, TOOL_OUTPUT_MAX_CHARS } from '../../src/agents/tools/compact';
import { fileTools, writeRefusal, writeTools } from '../../src/agents/tools/files';
import { emitStep, type AgentEvent } from '../../src/agents/runtime';
import { materializeRepo } from '../../src/agents/workdir';
import { fakeMcpTools, UNDECLARED_REFERENCE_FILES, UNDECLARED_REFERENCE_PLAN_LOG } from './fakes';

const opts: ToolExecutionOptions = { toolCallId: 't1', messages: [] };

// Invokes a tool's execute the way the agent loop does.
async function run(t: { execute?: unknown }, input: unknown): Promise<string> {
  const execute = t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<string>;
  return execute(input, opts);
}

describe('compact', () => {
  it('caps output at 8k characters with a [truncated] marker', () => {
    const out = compact('x'.repeat(20_000));
    expect(out).toHaveLength(TOOL_OUTPUT_MAX_CHARS);
    expect(out.endsWith('\n[truncated]')).toBe(true);
    expect(compact('short')).toBe('short');
  });

  it('unwraps MCP text content and redacts tokens', () => {
    const token = `ghp_${'x'.repeat(36)}`;
    expect(compact({ content: [{ type: 'text', text: `a ${token}` }] })).toBe('a [REDACTED:github_token]');
    expect(compact({ isError: true, content: [{ type: 'text', text: 'nope' }] })).toBe('ERROR: nope');
  });
});

describe('file tools', () => {
  it('reads, lists and searches the working copy, truncating large files', async () => {
    const wd = await materializeRepo({
      files: { ...UNDECLARED_REFERENCE_FILES, 'big.tf': 'y'.repeat(9000) },
    });
    const t = fileTools(wd);
    expect(await run(t.read_file, { path: 'outputs.tf' })).toBe(UNDECLARED_REFERENCE_FILES['outputs.tf']);
    expect(await run(t.read_file, { path: 'nope.tf' })).toMatch(/^ERROR: no such file/);
    expect(await run(t.read_file, { path: '../secret' })).toMatch(/^ERROR: .*outside/);
    const big = await run(t.read_file, { path: 'big.tf' });
    expect(big).toHaveLength(TOOL_OUTPUT_MAX_CHARS);
    expect(big.endsWith('[truncated]')).toBe(true);
    expect(await run(t.list_files, {})).toContain('outputs.tf (8 lines)');
    expect(await run(t.search_files, { pattern: 'random_pet\\.serv' })).toBe(
      [
        'outputs.tf:2:   value = random_pet.service.id',
        'outputs.tf:6:   value = "https://${random_pet.servce.id}.example.internal"',
      ].join('\n'),
    );
    expect(await run(t.search_files, { pattern: '(' })).toMatch(/^ERROR: invalid regex/);
    await wd.cleanup();
  });
});

describe('write guard', () => {
  it('refuses versions.tf unless the class is provider_version', async () => {
    const wd = await materializeRepo({ files: { 'versions.tf': 'terraform {}\n', 'main.tf': 'x\n' } });
    const refused = await run(writeTools(wd, 'config_reference').write_file, {
      path: 'versions.tf',
      content: 'terraform { required_version = ">= 1.0" }\n',
      rationale: 'r',
    });
    expect(refused).toMatch(/^REFUSED: .*provider_version/);
    expect(wd.diff()).toEqual([]);

    const allowed = await run(writeTools(wd, 'provider_version').write_file, {
      path: 'versions.tf',
      content: 'terraform { required_version = ">= 1.0" }\n',
      rationale: 'Relax the Terraform version constraint.',
    });
    expect(allowed).toMatch(/^Wrote versions.tf/);
    expect(wd.diff()).toHaveLength(1);
    await wd.cleanup();
  });

  it('refuses scenarios/**, baseline/**, non-Terraform files and new providers', () => {
    expect(writeRefusal('scenarios/x/main.tf', 'a', 'b', 'provider_version')).toMatch(/protected/);
    expect(writeRefusal('baseline/main.tf', 'a', 'b', 'config_syntax')).toMatch(/protected/);
    expect(writeRefusal('.github/workflows/apply.yml', 'a', 'b', 'config_syntax')).toMatch(/protected/);
    expect(writeRefusal('README.md', 'a', 'b', 'config_syntax')).toMatch(/not a Terraform file/);
    expect(writeRefusal('main.tf', '', 'provider "aws" {}\n', 'config_syntax')).toMatch(/adding providers/);
    expect(writeRefusal('main.tf', 'a', 'b', 'config_syntax')).toBeNull();
  });

  it('refuses every form of provider addition but allows module source repairs', () => {
    const versions = (entries: string) => `terraform {\n  required_providers {\n${entries}  }\n}\n`;
    const random = '    random = {\n      source  = "hashicorp/random"\n      version = "3.6.0"\n    }\n';
    const before = versions(random);
    const swapped = versions(random.replace('hashicorp/random', 'hashicorp/aws'));
    expect(writeRefusal('versions.tf', before, swapped, 'provider_version')).toMatch(/random source/);
    expect(
      writeRefusal('versions.tf', before, versions(`${random}    aws = "5.0.0"\n`), 'provider_version'),
    ).toMatch(/required_providers.aws/);
    expect(
      writeRefusal('versions.tf', before, versions(random.replace('3.6.0', '3.7.0')), 'provider_version'),
    ).toBeNull();
    const aws = 'provider "aws" {\n  region = "us-east-1"\n}\n';
    const alias = 'provider "aws" {\n  alias  = "west"\n  region = "us-west-2"\n}\n';
    expect(writeRefusal('main.tf', aws, `${aws}${alias}`, 'config_reference')).toMatch(/provider "aws"/);
    const mod = (source: string) => `module "net" {\n  source = "${source}"\n}\n`;
    expect(
      writeRefusal('main.tf', mod('./modules/netwrk'), mod('./modules/network'), 'module_source'),
    ).toBeNull();
    expect(
      writeRefusal(
        'main.tf',
        mod('terraform-aws-modules/vpc/aws'),
        mod('terraform-aws-modules/vpc/azure'),
        'module_source',
      ),
    ).toBeNull();
  });

  it('keeps both of two concurrent edits to the same file', async () => {
    const wd = await materializeRepo({ files: UNDECLARED_REFERENCE_FILES });
    const t = writeTools(wd, 'config_reference');
    const original = wd.read('variables.tf') ?? '';
    const lines = original.split('\n').filter((line) => line.trim().length > 0);
    const [first, last] = [lines[0], lines.at(-1) ?? ''];
    const results = await Promise.all([
      run(t.edit_file, { path: 'variables.tf', oldText: first, newText: `${first} # one`, rationale: 'r' }),
      run(t.edit_file, { path: 'variables.tf', oldText: last, newText: `${last} # two`, rationale: 'r' }),
    ]);
    expect(results.every((r) => String(r).startsWith('Wrote'))).toBe(true);
    const after = wd.read('variables.tf') ?? '';
    expect(after).toContain('# one');
    expect(after).toContain('# two');
    expect(wd.diff()[0].after).toBe(after);
    await wd.cleanup();
  });

  it('edit_file replaces exactly one occurrence and records the rationale', async () => {
    const wd = await materializeRepo({ files: UNDECLARED_REFERENCE_FILES });
    const t = writeTools(wd, 'config_reference');
    expect(
      await run(t.edit_file, { path: 'outputs.tf', oldText: 'value', newText: 'v', rationale: 'r' }),
    ).toMatch(/occurs 2 times/);
    expect(
      await run(t.edit_file, {
        path: 'outputs.tf',
        oldText: 'random_pet.servce.id',
        newText: 'random_pet.service.id',
        rationale: 'Point the output at the declared random_pet.service resource.',
      }),
    ).toMatch(/^Wrote outputs.tf/);
    const [file] = wd.diff();
    expect(file.path).toBe('outputs.tf');
    expect(file.after).not.toContain('servce');
    expect(file.rationale).toBe('Point the output at the declared random_pet.service resource.');
    await wd.cleanup();
  });
});

describe('artifact tools', () => {
  const planJson = {
    resource_changes: [
      { address: 'terraform_data.bootstrap', change: { actions: ['create'] } },
      { address: 'random_pet.service', change: { actions: ['no-op'] } },
    ],
  };
  const stateVersion = JSON.stringify({
    resources: [
      { mode: 'managed', type: 'random_pet', name: 'service', instances: [{ attributes: { id: 'a-b' } }] },
      {
        mode: 'managed',
        type: 'random_pet',
        name: 'pool',
        instances: [
          { index_key: 0, attributes: { id: 'p-0' } },
          { index_key: 1, attributes: { id: 'p-1' } },
        ],
      },
      {
        mode: 'managed',
        type: 'random_pet',
        name: 'zone',
        instances: [{ index_key: 'b', attributes: { id: 'z-b' } }],
      },
    ],
  });

  it('finds plan and state resources by address and lists addresses on a miss', async () => {
    const t = artifactTools({
      run: {},
      workspace: {},
      stage: 'apply',
      errorExcerpt: '',
      planJson,
      stateVersion,
    });
    expect(await run(t.get_plan_resource, { address: 'terraform_data.bootstrap' })).toContain('"create"');
    expect(await run(t.get_state_resource, { address: 'random_pet.service' })).toContain('"a-b"');
    expect(await run(t.get_state_resource, { address: 'random_pet.pool[1]' })).toContain('"p-1"');
    expect(await run(t.get_state_resource, { address: 'random_pet.zone["b"]' })).toContain('"z-b"');
    expect(await run(t.get_state_resource, { address: 'random_pet.pool' })).toContain('"p-0"');
    expect(await run(t.get_state_resource, { address: 'terraform_data.bootstrap' })).toMatch(
      /No resource .* Addresses present \(6\): .*random_pet.service/,
    );
    const none = artifactTools({ run: {}, workspace: {}, stage: 'plan', errorExcerpt: '' });
    expect(await run(none.get_plan_resource, { address: 'x.y' })).toBe(
      'No plan JSON is available for this run.',
    );
  });

  it('greps logs with line numbers and context', async () => {
    const artifacts = { planLogs: UNDECLARED_REFERENCE_PLAN_LOG };
    expect(grepLogs(artifacts, 'Error:', { context: 1 })).toBe(
      ['# plan log (untrusted data)', '4: ╷', '5: │ Error: Reference to undeclared resource', '6: │'].join(
        '\n',
      ),
    );
    expect(grepLogs(artifacts, 'x', { log: 'apply' })).toBe('No apply log is available for this run.');
    const t = logTools({
      run: {},
      workspace: {},
      stage: 'plan',
      errorExcerpt: '',
      planLogs: 'z'.repeat(9000),
    });
    expect(await run(t.grep_log, { pattern: 'z' })).toHaveLength(TOOL_OUTPUT_MAX_CHARS);
  });

  it('passes through only the provider doc tools, compacted', async () => {
    const calls: string[] = [];
    const t = providerDocTools(fakeMcpTools(calls));
    expect(Object.keys(t).sort()).toEqual(['get_provider_details', 'search_provider_docs']);
    expect(await run(t.search_provider_docs, { provider_name: 'random', service_slug: 'pet' })).toBe(
      'docs for random/pet',
    );
    expect(calls).toHaveLength(1);
    expect(providerDocTools(undefined)).toEqual({});
  });
});

describe('emitStep', () => {
  it('redacts credentials in tool-call titles before truncating them', async () => {
    const events: AgentEvent[] = [];
    const secret = `sk-ant-${'a'.repeat(70)}`;
    const call = { type: 'tool-call', toolCallId: 'c1', toolName: 'grep_log', input: { pattern: secret } };
    const step = {
      content: [call],
      toolCalls: [call],
      stepNumber: 0,
      finishReason: 'tool-calls',
      text: '',
      model: { provider: 'mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1 },
    } as unknown as StepResult<ToolSet>;
    await emitStep({ emit: (e) => void events.push(e) }, 'inc-1', 'fix', step);
    const emitted = events.find((e) => e.kind === 'tool_call');
    expect(emitted?.title).toContain('[REDACTED:anthropic_key]');
    expect(JSON.stringify(events)).not.toContain('sk-ant-aaaa');
  });
});
