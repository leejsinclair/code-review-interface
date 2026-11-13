// The ruleset in force for one snapshot: the built-in rules plus the optional rule file (research RR-4,
// contracts/rule-file.md). The file can only add scrutiny: `extend` adds paths and line terms to a built-in rule
// and may raise (never lower) its class; `add` defines a new rule `X-<NAME>`. An entry that breaks a rule is
// skipped and named in the notice; a file that cannot be read as a whole is ignored; the built-ins always apply.
// Patterns are globs and plain terms only, so no regular expression is ever built from the file.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_RULESET_NUMBER, SENSITIVE_RULES, type Rule, type RuleFamily } from './builtin-rules.ts';
import { isHigher, isRiskClass, type RiskClass } from './classes.ts';
import { validateGlob } from './glob.ts';

export type RuleFileStatus = 'absent' | 'used' | 'partly-ignored' | 'ignored';

export type Ruleset = {
  /** `builtin-<N>`, or `builtin-<N>+<12 hex>` when a rule file contributed (RR-4). */
  version: string;
  ruleFile: RuleFileStatus;
  notice: Array<{ entry: string; reason: string }>;
  rules: Rule[];
};

export const RULE_FILE_NAME = 'risk-rules.json';

const FAMILIES: readonly RuleFamily[] = ['authentication', 'authorisation', 'deletion', 'financial', 'migration', 'configuration'];
const EXTENDABLE = SENSITIVE_RULES.map((r) => r.id);
const MECHANICAL = ['R-LOCKFILE', 'R-GENERATED', 'R-COMMENT-ONLY', 'R-RENAME-ONLY', 'R-TEST'];
const ADDABLE_ID = /^X-[A-Z0-9-]{1,30}$/;
const MAX_PATTERNS = 100;
const MAX_TERM_LENGTH = 100;
const FIELDS_EXTEND = ['extend', 'paths', 'lineTerms', 'class'];
const FIELDS_ADD = ['add', 'family', 'class', 'label', 'paths', 'lineTerms'];

const builtins = (): Rule[] => SENSITIVE_RULES.map((r) => ({ ...r, paths: [...r.paths], lineTerms: [...r.lineTerms] }));

type Accepted = { entry: Record<string, unknown>; apply: (rules: Rule[]) => void };

/** The reason an entry cannot be used, or the change it makes. */
function checkEntry(raw: unknown, taken: ReadonlySet<string>): { reason: string } | Accepted {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'an entry must be an object' };
  const e = raw as Record<string, unknown>;
  const hasExtend = e['extend'] !== undefined;
  const hasAdd = e['add'] !== undefined;
  if (hasExtend && hasAdd) return { reason: 'only one of "extend" and "add" is allowed in an entry' };
  if (!hasExtend && !hasAdd) return { reason: 'an entry needs "extend" (a built-in rule ID) or "add" (a new rule ID)' };
  const allowed = hasExtend ? FIELDS_EXTEND : FIELDS_ADD;
  for (const key of Object.keys(e)) if (!allowed.includes(key)) return { reason: `unknown field "${key}"` };

  const paths = e['paths'] === undefined ? [] : e['paths'];
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) return { reason: '"paths" must be a list of text patterns' };
  if (paths.length > MAX_PATTERNS) return { reason: `more than ${MAX_PATTERNS} paths in one entry` };
  for (const p of paths as string[]) {
    const bad = validateGlob(p);
    if (bad !== null) return { reason: `malformed path pattern: ${bad}` };
  }
  const terms = e['lineTerms'] === undefined ? [] : e['lineTerms'];
  if (!Array.isArray(terms) || !terms.every((t) => typeof t === 'string')) return { reason: '"lineTerms" must be a list of text terms' };
  if (terms.length > MAX_PATTERNS) return { reason: `more than ${MAX_PATTERNS} line terms in one entry` };
  for (const t of terms as string[]) if (t.length < 2 || t.length > MAX_TERM_LENGTH) return { reason: `a line term must be 2 to ${MAX_TERM_LENGTH} characters` };
  const newPaths = paths as string[];
  const newTerms = (terms as string[]).map((t) => t.toLowerCase());

  if (hasExtend) {
    const id = e['extend'];
    if (typeof id !== 'string') return { reason: '"extend" must be a built-in rule ID' };
    if (MECHANICAL.includes(id)) return { reason: `${id} is a mechanical rule; a rule file can only add scrutiny` };
    if (!EXTENDABLE.includes(id)) return { reason: `no built-in rule ${id} to extend` };
    const cls = e['class'];
    if (cls !== undefined && !isRiskClass(cls)) return { reason: 'class must be one of low, normal, elevated or critical' };
    const builtinClass = SENSITIVE_RULES.find((r) => r.id === id)?.class ?? 'critical';
    if (cls !== undefined && isHigher(builtinClass, cls)) return { reason: `class ${cls} is lower than ${id}'s ${builtinClass}; a rule file can only add scrutiny` };
    return {
      entry: e,
      apply(rules) {
        const rule = rules.find((r) => r.id === id);
        if (rule === undefined) return;
        if (cls !== undefined && isHigher(cls as RiskClass, rule.class)) rule.class = cls as RiskClass;
        rule.paths.push(...newPaths.filter((p) => !rule.paths.includes(p)));
        rule.filePaths = [...(rule.filePaths ?? []), ...newPaths.filter((p) => !(rule.filePaths ?? []).includes(p))];
        rule.lineTerms.push(...newTerms.filter((t) => !rule.lineTerms.includes(t)));
        if (newTerms.length > 0 && rule.floor === null) rule.floor = 'elevated';
      },
    } satisfies Accepted & { reason?: never };
  }

  const id = e['add'];
  if (typeof id !== 'string') return { reason: '"add" must be a new rule ID' };
  if (EXTENDABLE.includes(id) || MECHANICAL.includes(id)) return { reason: `"${id}" is a built-in rule ID; a new rule needs an ID like X-NAME` };
  if (!ADDABLE_ID.test(id)) return { reason: 'the ID must be X- followed by 1 to 30 of A-Z, 0-9 or -' };
  if (taken.has(id)) return { reason: `${id} is already defined in this file` };
  const family = e['family'];
  if (!FAMILIES.includes(family as RuleFamily)) return { reason: `a new rule needs a family, one of ${FAMILIES.join(', ')}` };
  const cls = e['class'];
  if (cls !== 'elevated' && cls !== 'critical') return { reason: 'a new rule needs a class of elevated or critical' };
  const label = e['label'];
  if (label !== undefined && (typeof label !== 'string' || label.length < 1 || label.length > 80)) return { reason: 'label must be 1 to 80 characters of text' };
  return {
    entry: e,
    apply(rules) {
      rules.push({
        id,
        family: family as RuleFamily,
        label: typeof label === 'string' ? label : `Custom rule ${id}`,
        class: cls,
        floor: newTerms.length > 0 ? 'elevated' : null,
        paths: [...newPaths],
        lineTerms: [...newTerms],
        filePaths: [...newPaths],
      });
    },
  };
}

/** Canonical JSON: keys sorted, so key order and whitespace in the file do not change the version. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const label = (index: number, raw: unknown): string => {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const id = typeof o['add'] === 'string' ? o['add'] : typeof o['extend'] === 'string' ? o['extend'] : '(no id)';
  return `${index}: ${id}`;
};

/** The ruleset for the text of a rule file (null: no file). Never throws. */
export function rulesetFromText(text: string | null): Ruleset {
  const base = `builtin-${BUILTIN_RULESET_NUMBER}`;
  if (text === null) return { version: base, ruleFile: 'absent', notice: [], rules: builtins() };
  const whole = (reason: string): Ruleset => ({ version: base, ruleFile: 'ignored', notice: [{ entry: '(file)', reason }], rules: builtins() });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return whole('the file is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return whole('the file must be a JSON object');
  const file = parsed as Record<string, unknown>;
  if (file['version'] !== 1) return whole('"version" must be 1');
  const entries = file['entries'];
  if (!Array.isArray(entries)) return whole('"entries" must be a list');

  const rules = builtins();
  const notice: Ruleset['notice'] = [];
  const accepted: unknown[] = [];
  const taken = new Set<string>();
  entries.forEach((raw: unknown, index: number) => {
    const result = checkEntry(raw, taken);
    if ('reason' in result) {
      notice.push({ entry: label(index, raw), reason: result.reason });
      return;
    }
    result.apply(rules);
    const added = result.entry['add'];
    if (typeof added === 'string') taken.add(added);
    accepted.push(result.entry);
  });
  const hash = accepted.length === 0 ? '' : `+${createHash('sha256').update(canonical(accepted)).digest('hex').slice(0, 12)}`;
  return { version: `${base}${hash}`, ruleFile: notice.length === 0 ? 'used' : 'partly-ignored', notice, rules };
}

/**
 * The ruleset for one classification: the built-ins, and `<appDataDir>/risk-rules.json` when the directory is given
 * and the file exists. Read at every snapshot, so an edit is picked up by the next one (FR-037). A file that cannot
 * be read is ignored with a notice and never blocks classification (V.4).
 */
export function loadRuleset(appDataDir?: string): Ruleset {
  if (appDataDir === undefined) return rulesetFromText(null);
  try {
    return rulesetFromText(readFileSync(join(appDataDir, RULE_FILE_NAME), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return rulesetFromText(null);
    const out = rulesetFromText(null);
    return { ...out, ruleFile: 'ignored', notice: [{ entry: '(file)', reason: 'the file could not be read' }] };
  }
}

