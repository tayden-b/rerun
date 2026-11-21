import type { DecisionProvider } from '../src/shared/types';

/**
 * Meaning-preserving perturbations of the SPEC §4 decision state (Almeida's robustness test):
 * a robust provider gives the same verdict for every variant.
 */
export const PERTURBATIONS = ['rename', 'uuidLine', 'reorder', 'whitespace'] as const;
export type Perturbation = (typeof PERTURBATIONS)[number];

/** mulberry32: small, fast, deterministic PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const hex = (rand: () => number, n: number) =>
  Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

export function seededUuid(rand: () => number): string {
  return `${hex(rand, 8)}-${hex(rand, 4)}-4${hex(rand, 3)}-${'89ab'[Math.floor(rand() * 4)]}${hex(rand, 3)}-${hex(rand, 12)}`;
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A resource type always contains an underscore (`random_pet`, `terraform_data`), which keeps file
// names such as `main.tf` and hosts such as `registry.terraform.io` out of the rename set.
const TYPE = '[a-z][a-z0-9]*_[a-z0-9_]*';
const NAME = '[A-Za-z_][A-Za-z0-9_-]*';
const ADDRESS_PATTERNS = [
  new RegExp(`\\bwith (?:data\\.)?(${TYPE})\\.(${NAME})`, 'g'),
  new RegExp(`resource "(${TYPE})" "(${NAME})"`, 'g'),
  new RegExp(`data "(${TYPE})" "(${NAME})"`, 'g'),
  new RegExp(`^(?:data\\.)?(${TYPE})\\.(${NAME})(?=[:\\s(]|$)`, 'gm'),
  new RegExp(`^(?:module\\.${NAME}\\.)*(?:data\\.)?(${TYPE})\\.(${NAME})(?:\\[[^\\]]*\\])?$`, 'g'),
];

function walkStrings(value: unknown, visit: (s: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      visit(k);
      walkStrings(v, visit);
    }
  }
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), mapStrings(v, fn)]));
  }
  return value;
}

/** Resource `type.name` pairs mentioned anywhere in the state (plan addresses, log lines, diagnostics). */
export function findResources(state: unknown): { type: string; name: string }[] {
  const seen = new Map<string, { type: string; name: string }>();
  walkStrings(state, (s) => {
    for (const re of ADDRESS_PATTERNS) {
      for (const m of s.matchAll(re)) seen.set(`${m[1]}.${m[2]}`, { type: m[1], name: m[2] });
    }
  });
  return [...seen.values()].sort((a, b) => `${a.type}.${a.name}`.localeCompare(`${b.type}.${b.name}`));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Renames every resource consistently in all strings and keys: `type.name` and `"type" "name"`. */
export function renameResources(
  state: unknown,
  rand: () => number,
): { state: unknown; renames: Record<string, string> } {
  const resources = findResources(state);
  const renames: Record<string, string> = {};
  const rules = resources.map(({ type, name }) => {
    const next = `${name}_${hex(rand, 4)}`;
    renames[`${type}.${name}`] = `${type}.${next}`;
    return {
      dotted: new RegExp(`\\b${escape(type)}\\.${escape(name)}(?![A-Za-z0-9_-])`, 'g'),
      quoted: new RegExp(`"${escape(type)}" "${escape(name)}"`, 'g'),
      type,
      next,
    };
  });
  const renamed = mapStrings(state, (s) =>
    rules.reduce(
      (acc, r) => acc.replace(r.dotted, `${r.type}.${r.next}`).replace(r.quoted, `"${r.type}" "${r.next}"`),
      s,
    ),
  );
  return { state: renamed, renames };
}

function shuffleArrays(value: unknown, rand: () => number): unknown {
  if (Array.isArray(value)) return shuffle(value, rand).map((v) => shuffleArrays(v, rand));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      shuffle(Object.entries(value), rand).map(([k, v]) => [k, shuffleArrays(v, rand)]),
    );
  }
  return value;
}

function reshapeWhitespace(text: string, rand: () => number): string {
  const lines = text
    .split('\n')
    .map((line) => (line && rand() < 0.4 ? `${line}${' '.repeat(1 + Math.floor(rand() * 3))}` : line));
  lines.splice(1 + Math.floor(rand() * Math.max(1, lines.length - 1)), 0, '');
  return lines.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deterministic for a given `(state, seed)`. Applies, in order: consistent resource renames, a UUID
 * comment line appended to `errorExcerpt`, a shuffle of every array/object order inside `planSummary`
 * (and `changedFiles`), and trailing-space/blank-line noise in `errorExcerpt`.
 */
export function perturbState(
  state: unknown,
  seed: number,
  kinds: readonly Perturbation[] = PERTURBATIONS,
): { state: unknown; renames: Record<string, string>; uuid?: string } {
  const rand = prng(seed);
  let out: unknown = structuredClone(state);
  let renames: Record<string, string> = {};
  let uuid: string | undefined;
  if (kinds.includes('rename')) ({ state: out, renames } = renameResources(out, rand));
  if (!isRecord(out)) return { state: out, renames };
  const s = out;
  if (kinds.includes('uuidLine') && typeof s.errorExcerpt === 'string') {
    uuid = seededUuid(rand);
    s.errorExcerpt = `${s.errorExcerpt}\n# request-id ${uuid}`;
  }
  if (kinds.includes('reorder')) {
    if (s.planSummary !== undefined) s.planSummary = shuffleArrays(s.planSummary, rand);
    if (Array.isArray(s.changedFiles)) s.changedFiles = shuffle(s.changedFiles, rand);
  }
  if (kinds.includes('whitespace') && typeof s.errorExcerpt === 'string') {
    s.errorExcerpt = reshapeWhitespace(s.errorExcerpt, rand);
  }
  return { state: s, renames, uuid };
}

/** Wraps a provider so every `decide()` sees a perturbed state. */
export function perturbingProvider(inner: DecisionProvider, seed: number): DecisionProvider {
  return {
    name: inner.name,
    decide: (state, questions) => inner.decide(perturbState(state, seed).state, questions),
  };
}
