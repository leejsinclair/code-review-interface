// T021: `npm run gitlab:clean` (FR-046). Removes every `it-*` project, group and user that crashed
// live runs left on the local GitLab. Manual only: no test imports or runs this, because a parallel
// run's items also start with `it-`. The shared `prwb-it` parent group is kept.
//
// GitlabAdmin refuses a non-loopback GITLAB_URL before any request (FR-027).

import { GitlabAdmin } from '../seeder/gitlab-seeder.ts';
import { GITLAB_TOKEN, GITLAB_URL } from './env.ts';

const admin = new GitlabAdmin({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
const { projects, groups, users } = await admin.listRunItems();
const failures: string[] = [];

const remove = async (label: string, work: () => Promise<void>): Promise<void> => {
  try {
    await work();
    console.log(`removed ${label}`);
  } catch (error) {
    failures.push(`${label}: ${(error as Error).message}`);
  }
};

for (const p of projects) await remove(`project ${p.path_with_namespace}`, () => admin.deleteProject(p.id));
// Deepest first, so a parent group never removes a child out from under the loop.
for (const g of [...groups].sort((a, b) => b.full_path.length - a.full_path.length)) {
  await remove(`group ${g.full_path}`, () => admin.deleteGroup(g.id));
}
for (const u of users) await remove(`user ${u.username}`, () => admin.deleteUser(u.id));

if (projects.length + groups.length + users.length === 0) console.log(`no it-* items on ${GITLAB_URL}`);
if (failures.length > 0) {
  console.error(`could not remove:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
