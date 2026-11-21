// T008 (VO-006, VO-007; FR-005, FR-007, FR-008, SC-003): the demo seed against the local GitLab, in a run-scoped
// subgroup so a maintainer's demo is never touched. Seeding twice creates nothing the second time; clean removes the
// subgroup and the two users and leaves `prwb-it` and `prwb-demo` in place. The `it-` names mean `npm run gitlab:clean`
// sweeps anything a crashed run leaves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clean } from '../demo/clean.ts';
import { demoUsers, projects } from '../demo/scenarios.ts';
import { seed } from '../demo/seed.ts';
import { GitlabAdmin } from '../seeder/gitlab-seeder.ts';
import { GITLAB_TOKEN, GITLAB_URL, gitlabGate } from './env.ts';

const gate = await gitlabGate();

test('demo seed is idempotent and clean removes only its own subgroup and users', { ...gate, timeout: 900_000 }, async () => {
  const stamp = `it-demo-${Date.now().toString(36)}`;
  const options = { group: `prwb-demo/${stamp}`, userPrefix: stamp };
  const admin = new GitlabAdmin({ baseUrl: GITLAB_URL, token: GITLAB_TOKEN });
  const hadIt = (await admin.findGroup('prwb-it')) !== null;
  try {
    const first = await seed(options);
    const kinds = (kind: string) => first.filter((l) => l.kind === kind).length;
    assert.equal(kinds('project'), projects.length);
    assert.equal(kinds('merge_request'), projects.reduce((n, p) => n + p.mergeRequests.length, 0));
    assert.equal(kinds('issue'), 1);
    assert.equal(kinds('user'), 2);
    for (const line of first.filter((l) => l.kind === 'merge_request')) assert.ok(line.purpose.length > 0, `${line.key} has its purpose`);
    assert.ok(first.some((l) => l.status === 'created'));

    const second = await seed(options);
    assert.deepEqual(second.map((l) => `${l.kind} ${l.key}`), first.map((l) => `${l.kind} ${l.key}`));
    assert.deepEqual(second.filter((l) => l.status !== 'exists'), [], 'the second run creates nothing');
  } finally {
    const removed = await clean(options);
    assert.ok(removed.some((l) => l.includes(options.group)));
  }
  assert.equal(await admin.findGroup(options.group), null, 'the run subgroup is gone');
  for (const u of demoUsers(stamp)) assert.equal(await admin.findUser(u.username), undefined, `${u.username} is gone`);
  assert.notEqual(await admin.findGroup('prwb-demo'), null, 'the demo parent group stays');
  assert.equal((await admin.findGroup('prwb-it')) !== null, hadIt, 'prwb-it is untouched');
});
