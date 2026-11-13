// Which changed lines are behavioural (research RR-2). A line is non-behavioural when it is blank or, for a
// language in the comment table, a comment on its own. A trailing comment after code is code. A language that
// is not in the table has no comments, so every non-blank changed line is behavioural: the lexical test errs
// toward "behavioural", which can only raise a class (FR-006). No parser exists here (constitution VI.1).

import { basename, extname } from 'node:path/posix';
import type { Side } from '../../contracts/http.ts';
import { hunksOf, type ChangedLine } from './patch.ts';

type Syntax = { line: readonly string[]; block: ReadonlyArray<readonly [string, string]> };

const C_LIKE: Syntax = { line: ['//'], block: [['/*', '*/']] };
const HASH: Syntax = { line: ['#'], block: [] };
const SYNTAXES: Record<string, Syntax> = {};
const define = (extensions: string[], syntax: Syntax): void => {
  for (const e of extensions) SYNTAXES[e] = syntax;
};
define(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.java', '.kt', '.go', '.rs', '.cs', '.swift', '.scala', '.c', '.h', '.cpp', '.hpp', '.cc'], C_LIKE);
define(['.php'], { line: ['//', '#'], block: [['/*', '*/']] });
define(['.css', '.scss'], { line: ['//'], block: [['/*', '*/']] });
define(['.py', '.rb', '.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml', '.tf', '.tfvars'], HASH);
define(['.sql'], { line: ['--'], block: [['/*', '*/']] });
define(['.html', '.xml', '.md', '.markdown', '.svg'], { line: [], block: [['<!--', '-->']] });

/** Languages where indentation carries meaning, so a reindent is a behavioural change. */
const WHITESPACE_SIGNIFICANT = new Set(['.py', '.yml', '.yaml', '.mk', '.fs', '.hs']);

export type ChangeInput = {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  patch: string | null;
};

export type AnalysedLine = ChangedLine & { behavioural: boolean };

export type ChangeAnalysis = {
  lines: AnalysedLine[];
  behaviouralLines: AnalysedLine[];
  hasAnyChange: boolean;
  /** True when any change can alter behaviour: a behavioural line, an added or deleted file, or no patch to read. */
  hasBehaviouralChange: boolean;
};

const syntaxFor = (path: string): Syntax | null => {
  const name = basename(path).toLowerCase();
  if (name === 'makefile') return null;
  return SYNTAXES[extname(name)] ?? null;
};
const significantWhitespace = (path: string): boolean => {
  const name = basename(path).toLowerCase();
  return name === 'makefile' || WHITESPACE_SIGNIFICANT.has(extname(name));
};

/** Line state of one side of a hunk: in a block comment (and which closer) or not. */
type SideState = { closer: string | null };

/** True when the line is a comment on its own; updates the block state. */
function commentOnly(text: string, syntax: Syntax, state: SideState): boolean {
  let rest = text.trim();
  if (state.closer !== null) {
    const at = rest.indexOf(state.closer);
    if (at === -1) return true;
    rest = rest.slice(at + state.closer.length).trim();
    state.closer = null;
    if (rest === '') return true;
  }
  for (;;) {
    if (rest === '') return true;
    if (syntax.line.some((prefix) => rest.startsWith(prefix))) return true;
    const block = syntax.block.find(([open]) => rest.startsWith(open));
    if (block === undefined) return false;
    const [open, close] = block;
    const at = rest.indexOf(close, open.length);
    if (at === -1) {
      state.closer = close;
      return true;
    }
    rest = rest.slice(at + close.length).trim();
  }
}

const stripped = (text: string): string => text.replace(/\s+/g, '');

export function analyseChange(file: ChangeInput): ChangeAnalysis {
  const hunks = hunksOf(file.patch);
  const syntax = syntaxFor(file.path);
  const whole = file.status === 'added' || file.status === 'deleted';
  const lines: AnalysedLine[] = [];

  for (const hunk of hunks) {
    const head: SideState = { closer: null };
    const base: SideState = { closer: null };
    const hunkLines: AnalysedLine[] = [];
    for (const l of hunk.lines) {
      // Context lines move both sides' comment state; added lines move head, removed lines move base.
      const states: Array<[SideState, boolean]> = [];
      if (l.type !== 'remove') states.push([head, true]);
      if (l.type !== 'add') states.push([base, true]);
      let isComment = false;
      for (const [state] of states) {
        const c = syntax === null ? l.text.trim() === '' : commentOnly(l.text, syntax, state);
        isComment = c;
      }
      if (l.type === 'context') continue;
      const side: Side = l.type === 'add' ? 'head' : 'base';
      const line = l.type === 'add' ? l.newLine : l.oldLine;
      if (line === undefined) continue;
      hunkLines.push({ side, line, text: l.text, behavioural: !isComment });
    }
    // A reindent: the removed lines equal the added lines once whitespace is removed, in the same order.
    if (!significantWhitespace(file.path)) {
      const removed = hunkLines.filter((l) => l.side === 'base').map((l) => stripped(l.text)).filter((t) => t !== '');
      const added = hunkLines.filter((l) => l.side === 'head').map((l) => stripped(l.text)).filter((t) => t !== '');
      if (removed.length > 0 && removed.length === added.length && removed.every((t, i) => t === added[i])) {
        for (const l of hunkLines) l.behavioural = false;
      }
    }
    lines.push(...hunkLines);
  }

  const noPatch = file.patch === null;
  const behaviouralLines = lines.filter((l) => l.behavioural);
  return {
    lines,
    behaviouralLines,
    hasAnyChange: lines.length > 0,
    hasBehaviouralChange: whole || noPatch || behaviouralLines.length > 0,
  };
}
