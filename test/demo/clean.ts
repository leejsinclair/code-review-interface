// `npm run gitlab:demo:clean` (008 US2; FR-008): removes the demo subgroup, its projects and the two demo users, and
// nothing else. `prwb-demo` itself stays: GitLab cannot permanently remove a top-level group (R2).

import { demoUsers } from './scenarios.ts';
import { demoTarget, type DemoOptions } from './seed.ts';

export async function clean(options: DemoOptions = {}): Promise<string[]> {
  const { admin, group, userPrefix } = await demoTarget(options);
  const lines: string[] = [];
  const found = await admin.findGroup(group);
  if (found === null || found.full_path !== group) lines.push(`absent group ${group}`);
  else {
    for (const p of await admin.list(`/groups/${found.id}/projects?include_subgroups=true`)) await admin.deleteProject(p.id);
    await admin.deleteGroup(found.id);
    lines.push(`removed group ${group}`);
  }
  for (const u of demoUsers(userPrefix)) {
    const user = await admin.findUser(u.username);
    if (user === undefined) lines.push(`absent user ${u.username}`);
    else {
      await admin.deleteUser(user.id);
      lines.push(`removed user ${u.username}`);
    }
  }
  return lines;
}

// Not import.meta.main: Node 24.2 reports false for a .ts entry file.
if (process.argv[1] === import.meta.filename) {
  try {
    for (const line of await clean()) console.log(line);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
