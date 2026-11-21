// T013 (VO-012; FR-009): the screenshot run's workbench uses temp app data and the fake `claude` CLI, points HOME at
// the clones' own credential home, and puts PATH, HOME and XDG_DATA_HOME back when its after-hooks run. The keyring is
// the fake one by construction (startWorkbench never opens the real keychain).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { startWorkbench } from '../helpers/fake-ai-cli.ts';
import { createAfterHooks } from '../demo/after-hooks.ts';
import { workbenchOptions } from '../demo/screenshots.ts';

test('the screenshot workbench is isolated and the environment is restored afterwards', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'prwb-demo-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const before = { PATH: process.env.PATH, HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
  const hooks = createAfterHooks();
  try {
    const bench = await startWorkbench(
      hooks,
      workbenchOptions(hooks, {
        home,
        live: {
          repository: { platform: 'gitlab', id: 'prwb-demo/acme/storefront', baseUrl: 'http://127.0.0.1:9' },
          issueTracker: { platform: 'gitlab-issues', site: 'http://127.0.0.1:9' },
          credentials: {},
          clonePath: join(home, 'no-clone'),
          fetch: async () => new Response('{}', { status: 404 }),
        },
      }),
    );
    assert.ok(bench.appData.root.startsWith(tmpdir()), 'app data is in the OS temp folder');
    assert.equal(process.env.XDG_DATA_HOME, bench.appData.root);
    assert.equal(process.env.HOME, home);
    assert.ok(bench.fake !== null);
    assert.equal(process.env.PATH?.split(delimiter)[0], bench.fake.binDir, 'the fake claude is first on PATH');
  } finally {
    await hooks.run();
  }
  assert.deepEqual({ PATH: process.env.PATH, HOME: process.env.HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME }, before);
});
