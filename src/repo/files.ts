// File access at a commit, for reference checks and the code view (research R11, R13, FR-016,
// FR-035). Reads run against the reviewer's clone, where the workbench's `refs/prwb/` refs keep the
// snapshot commits; the worktree may already be gone. Every git call goes through git.ts.

import { countLines, readFileAtCommit, type Git } from './git.ts';

export type FileAtCommit = { status: 'ok'; lines: string[] } | { status: 'not_found' };

export interface FileReader {
  /** The file's line count at `commit`, or null when the commit or the path is not there. */
  lineCount(commit: string, path: string): Promise<number | null>;
  /** The file's lines at `commit`; `not_found` when the commit is gone or the path is absent. */
  read(commit: string, path: string): Promise<FileAtCommit>;
}

/** A repository-relative path git can look up at a commit. */
export function isRepositoryPath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.startsWith('-') && !path.includes('\0') && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes('..');
}

export function createFileReader(git: Git, clonePath: string): FileReader {
  const exists = async (commit: string, path: string): Promise<boolean> => {
    if (!isRepositoryPath(path)) return false;
    try {
      await git.run('fileExistsAtCommit', { commit, path }, { cwd: clonePath });
      return true;
    } catch {
      return false;
    }
  };

  const content = async (commit: string, path: string): Promise<Buffer | null> => {
    if (!(await exists(commit, path))) return null;
    try {
      return await readFileAtCommit(git, clonePath, commit, path);
    } catch {
      return null;
    }
  };

  return {
    async lineCount(commit, path) {
      const bytes = await content(commit, path);
      return bytes === null ? null : countLines(bytes);
    },
    async read(commit, path) {
      const bytes = await content(commit, path);
      if (bytes === null) return { status: 'not_found' };
      const text = bytes.toString('utf8');
      const lines = text.split('\n');
      if (text.endsWith('\n')) lines.pop();
      return { status: 'ok', lines: text === '' ? [] : lines };
    },
  };
}
