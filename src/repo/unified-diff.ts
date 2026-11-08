// One unified-diff parser for local (`git diff -M --patch`) and platform diffs
// (research R11, FR-033). Both diff sources render, limit and fingerprint the
// same way because they pass through this module.

import { createHash } from 'node:crypto';

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  /** Path at head; for a deleted file, the path at base. */
  path: string;
  /** Set for renamed and copied files, else null. */
  oldPath: string | null;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** The file's hunks from the first `@@`; null for binary files. */
  patch: string | null;
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DEV_NULL = '/dev/null';

interface FileBuilder {
  gitOld: string | null;
  gitNew: string | null;
  minusPath: string | null;
  plusPath: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  copyFrom: string | null;
  copyTo: string | null;
  added: boolean;
  deleted: boolean;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  patchLines: string[];
}

function newBuilder(): FileBuilder {
  return {
    gitOld: null,
    gitNew: null,
    minusPath: null,
    plusPath: null,
    renameFrom: null,
    renameTo: null,
    copyFrom: null,
    copyTo: null,
    added: false,
    deleted: false,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
    patchLines: [],
  };
}

/** Decodes a C-style quoted path as git writes it (`"a/t\303\251st"`). */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  const body = value.slice(1, -1);
  const bytes: number[] = [];
  const simple: Record<string, number> = {
    a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92,
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== '\\') {
      for (const byte of Buffer.from(ch, 'utf8')) bytes.push(byte);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function stripPrefix(path: string, prefix: 'a/' | 'b/'): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** A path from a `---`/`+++` line: unquoted, without its `a/`/`b/` prefix or trailing tab-separated timestamp. */
function markerPath(rest: string, prefix: 'a/' | 'b/'): string {
  let value = rest;
  if (!value.startsWith('"')) {
    const tab = value.indexOf('\t');
    if (tab >= 0) value = value.slice(0, tab);
  }
  value = unquote(value.trim());
  return value === DEV_NULL ? DEV_NULL : stripPrefix(value, prefix);
}

/** Reads `a/<old> b/<new>` from a `diff --git` line, quoted or not. */
function gitHeaderPaths(rest: string): { old: string; new: string } | null {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    if (end < 0) return null;
    const oldRaw = rest.slice(0, end + 1);
    const newRaw = rest.slice(end + 1).trim();
    return { old: stripPrefix(unquote(oldRaw), 'a/'), new: stripPrefix(unquote(newRaw), 'b/') };
  }
  if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "');
    if (start < 0) return null;
    return {
      old: stripPrefix(rest.slice(0, start), 'a/'),
      new: stripPrefix(unquote(rest.slice(start + 1)), 'b/'),
    };
  }
  // Unquoted: when old and new are the same path, the line splits at its middle.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ') {
    const oldPart = stripPrefix(rest.slice(0, half), 'a/');
    const newPart = stripPrefix(rest.slice(half + 1), 'b/');
    if (oldPart === newPart) return { old: oldPart, new: newPart };
  }
  const split = rest.indexOf(' b/');
  if (split < 0) return null;
  return { old: stripPrefix(rest.slice(0, split), 'a/'), new: rest.slice(split + 3) };
}

function closingQuote(value: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '\\') {
      i++;
      continue;
    }
    if (value[i] === '"') return i;
  }
  return -1;
}

function finish(builder: FileBuilder): DiffFile | null {
  const oldSide =
    builder.renameFrom ?? builder.copyFrom ??
    (builder.minusPath !== null && builder.minusPath !== DEV_NULL ? builder.minusPath : null) ??
    builder.gitOld;
  const newSide =
    builder.renameTo ?? builder.copyTo ??
    (builder.plusPath !== null && builder.plusPath !== DEV_NULL ? builder.plusPath : null) ??
    builder.gitNew;

  const added = builder.added || builder.minusPath === DEV_NULL;
  const deleted = builder.deleted || builder.plusPath === DEV_NULL;

  let status: DiffFileStatus;
  if (builder.renameFrom !== null || builder.renameTo !== null) status = 'renamed';
  else if (builder.copyFrom !== null || builder.copyTo !== null) status = 'copied';
  else if (added) status = 'added';
  else if (deleted) status = 'deleted';
  else status = 'modified';

  const path = status === 'deleted' ? oldSide ?? newSide : newSide ?? oldSide;
  if (path === null) return null;

  return {
    path,
    oldPath: status === 'renamed' || status === 'copied' ? oldSide : null,
    status,
    additions: builder.additions,
    deletions: builder.deletions,
    binary: builder.binary,
    patch: builder.binary ? null : builder.patchLines.length > 0 ? `${builder.patchLines.join('\n')}\n` : '',
    hunks: builder.binary ? [] : builder.hunks,
  };
}

interface ParseState {
  files: DiffFile[];
  current: FileBuilder | null;
  hunk: DiffHunk | null;
  oldRemaining: number;
  newRemaining: number;
  oldLine: number;
  newLine: number;
  /** Whether the current file has passed its header (a hunk or binary marker was seen). */
  inBody: boolean;
}

function closeFile(st: ParseState): void {
  if (st.current !== null) {
    const file = finish(st.current);
    if (file !== null) st.files.push(file);
  }
  st.current = null;
  st.hunk = null;
  st.oldRemaining = 0;
  st.newRemaining = 0;
  st.inBody = false;
}

/** Reads one hunk content line; the hunk's counts say it is content. */
function readHunkLine(st: ParseState, builder: FileBuilder, hunk: DiffHunk, line: string): boolean {
  const marker = line[0];
  if (marker === '\\') {
    builder.patchLines.push(line);
    return true;
  }
  if (marker === '+') {
    hunk.lines.push({ type: 'add', newLine: st.newLine++, text: line.slice(1) });
    builder.additions++;
    st.newRemaining--;
  } else if (marker === '-') {
    hunk.lines.push({ type: 'remove', oldLine: st.oldLine++, text: line.slice(1) });
    builder.deletions++;
    st.oldRemaining--;
  } else if (marker === ' ' || line === '') {
    hunk.lines.push({ type: 'context', oldLine: st.oldLine++, newLine: st.newLine++, text: line.slice(1) });
    st.oldRemaining--;
    st.newRemaining--;
  } else {
    // A truncated hunk: the line is not content.
    st.hunk = null;
    st.oldRemaining = 0;
    st.newRemaining = 0;
    return false;
  }
  builder.patchLines.push(line);
  return true;
}

/** Reads a line outside hunk content: file headers, hunk headers and markers. */
function readHeaderLine(st: ParseState, line: string): void {
  if (line.startsWith('diff --git ')) {
    closeFile(st);
    const builder = newBuilder();
    const paths = gitHeaderPaths(line.slice('diff --git '.length));
    if (paths !== null) {
      builder.gitOld = paths.old;
      builder.gitNew = paths.new;
    }
    st.current = builder;
    return;
  }

  const hunkMatch = HUNK_HEADER.exec(line);
  if (hunkMatch !== null && st.current !== null) {
    const hunk: DiffHunk = {
      oldStart: Number(hunkMatch[1]),
      oldLines: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
      newStart: Number(hunkMatch[3]),
      newLines: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
      lines: [],
    };
    st.current.hunks.push(hunk);
    st.current.patchLines.push(line);
    st.hunk = hunk;
    st.oldRemaining = hunk.oldLines;
    st.newRemaining = hunk.newLines;
    st.oldLine = hunk.oldStart;
    st.newLine = hunk.newStart;
    st.inBody = true;
    return;
  }

  if (line.startsWith('--- ') && (st.current === null || st.inBody)) {
    // A plain unified diff (no `diff --git` line) starts a file at `---`.
    closeFile(st);
    st.current = newBuilder();
  }

  const builder = st.current;
  if (builder === null) return;

  if (line.startsWith('\\')) {
    if (builder.patchLines.length > 0) builder.patchLines.push(line);
    return;
  }
  if (st.inBody) return;

  if (line.startsWith('--- ')) {
    builder.minusPath = markerPath(line.slice(4), 'a/');
  } else if (line.startsWith('+++ ')) {
    builder.plusPath = markerPath(line.slice(4), 'b/');
  } else if (line.startsWith('new file mode')) {
    builder.added = true;
  } else if (line.startsWith('deleted file mode')) {
    builder.deleted = true;
  } else if (line.startsWith('rename from ')) {
    builder.renameFrom = unquote(line.slice('rename from '.length));
  } else if (line.startsWith('rename to ')) {
    builder.renameTo = unquote(line.slice('rename to '.length));
  } else if (line.startsWith('copy from ')) {
    builder.copyFrom = unquote(line.slice('copy from '.length));
  } else if (line.startsWith('copy to ')) {
    builder.copyTo = unquote(line.slice('copy to '.length));
  } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
    builder.binary = true;
    const match = /^Binary files (.*) and (.*) differ$/.exec(line);
    if (match !== null) {
      if (match[1] === DEV_NULL) builder.added = true;
      if (match[2] === DEV_NULL) builder.deleted = true;
    }
    st.inBody = true;
  }
}

/** Parses a unified diff into its files, in diff order. Line endings are normalised to `\n`. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const st: ParseState = {
    files: [],
    current: null,
    hunk: null,
    oldRemaining: 0,
    newRemaining: 0,
    oldLine: 0,
    newLine: 0,
    inBody: false,
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    // Inside a hunk the counts decide what is content, so `--- x` or `diff` text in code is never a header.
    if (st.current !== null && st.hunk !== null && (st.oldRemaining > 0 || st.newRemaining > 0)) {
      if (readHunkLine(st, st.current, st.hunk, line)) continue;
    }
    readHeaderLine(st, line);
  }
  closeFile(st);
  return st.files;
}

/**
 * The diff fingerprint (research R11, data-model `diffFingerprint`): SHA-256 hex
 * of the normalised patch. The patch is rebuilt from the parsed files, so header
 * noise that differs between a local and a platform diff (index lines, modes,
 * hunk section headings, line endings) does not change it, while any change to
 * a file's path, status or hunk content does.
 */
export function diffFingerprint(files: readonly DiffFile[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`file ${file.status}\0${file.oldPath ?? ''}\0${file.path}\0${file.binary ? 'binary' : 'text'}\n`);
    for (const h of file.hunks) {
      hash.update(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n`);
      for (const l of h.lines) {
        const prefix = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
        hash.update(`${prefix}${l.text}\n`);
      }
    }
  }
  return hash.digest('hex');
}
