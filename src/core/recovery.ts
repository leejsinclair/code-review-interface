// Start-up sweep of leftover isolated workspaces (FR-009, EC-11, research R9, R17). Every directory
// under `<app-data>/workspaces/<session>/<snapshot>` is a worktree a killed run left behind: it is
// removed from its owning clone by its own path, found through the worktree's `.git` file, and its
// directory is deleted. No `worktree prune` is ever run, so the reviewer's own worktree entries are
// left exactly as they were.

import { readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { RepositoryManager } from '../repo/manager.ts';

/** The git directory shared by the clone that owns a worktree, or null when it cannot be read. */
async function owningGitDir(worktree: string): Promise<string | null> {
  try {
    const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(join(worktree, '.git'), 'utf8'))?.[1]?.trim();
    if (pointer === undefined) return null;
    const gitDir = isAbsolute(pointer) ? pointer : resolve(worktree, pointer);
    const common = (await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '')).trim();
    return common === '' ? dirname(dirname(gitDir)) : resolve(gitDir, common);
  } catch {
    return null;
  }
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

/** Removes every leftover workspace; returns the workspace paths removed, sorted. */
export async function sweepWorkspaces(options: { manager: RepositoryManager; workspacesDir: string }): Promise<string[]> {
  const removed: string[] = [];
  for (const sessionDir of await subdirectories(options.workspacesDir)) {
    for (const workspace of await subdirectories(sessionDir)) {
      const gitDir = await owningGitDir(workspace);
      if (gitDir === null) await rm(workspace, { recursive: true, force: true });
      else await options.manager.removeWorkspace(gitDir, workspace);
      removed.push(workspace);
    }
    await rmdir(sessionDir).catch(() => undefined);
  }
  return removed.sort();
}
