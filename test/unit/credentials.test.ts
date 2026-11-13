// VO-040 (FR-028, R6, constitution X.7 and X.8): the one credential module.
//
// `src/credentials.ts` (T037) keeps one keyring entry per platform under the
// service `pr-review-workbench`, never returns a secret, hands adapters an
// `authorize` callback that adds the header, and registers every secret it loads
// with the log scrubber. The keyring and the scrubber registration are injected,
// so this test uses the in-memory keyring and a spy; `main.ts` wires the real
// `@napi-rs/keyring` and `log.ts`. The full-session half of VO-040 is T111.
//
// The module is loaded inside each test body, so this file still loads before it exists.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { useTempAppData } from '../helpers/app-data.ts';
import { createFakeKeyring, type FakeKeyring } from '../helpers/fake-keyring.ts';
import type { CredentialStore } from '../../src/credentials.ts';

const loadCredentials = () => import('../../src/credentials.ts');

const SERVICE = 'pr-review-workbench';

const GITHUB_TOKEN = 'ghp_TEST0000secretGithubToken1111';
const BITBUCKET_TOKEN = 'ATATT3x_TEST_secretBitbucketToken2222';
const JIRA_TOKEN = 'ATATT3x_TEST_secretJiraToken3333';
const ALL_SECRETS = [GITHUB_TOKEN, BITBUCKET_TOKEN, JIRA_TOKEN];

const basic = (account: string, secret: string): string =>
  `Basic ${Buffer.from(`${account}:${secret}`, 'utf8').toString('base64')}`;

/** Every form a secret could leak in: raw, and inside a Basic header value. */
const leakForms = (): string[] => [
  ...ALL_SECRETS,
  basic('reviewer@example.com', BITBUCKET_TOKEN).slice('Basic '.length),
  basic('reviewer@example.com', JIRA_TOKEN).slice('Basic '.length),
];

function assertNoSecret(value: unknown, where: string): void {
  const text = typeof value === 'string' ? value : `${inspect(value, { depth: 10, showHidden: true })}\n${safeJson(value)}`;
  for (const secret of leakForms()) assert.ok(!text.includes(secret), `${where} contains a secret`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

async function makeStore(keyring: FakeKeyring) {
  const { createCredentials } = await loadCredentials();
  const registered: string[] = [];
  const store: CredentialStore = createCredentials({
    keyring,
    registerSecret: (secret: string) => {
      registered.push(secret);
    },
  });
  return { store, registered };
}

async function saveAll(store: CredentialStore): Promise<void> {
  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer' });
  await store.save('bitbucket-cloud', { account: 'reviewer@example.com', secret: BITBUCKET_TOKEN, scheme: 'basic' });
  await store.save('jira-cloud', { account: 'reviewer@example.com', secret: JIRA_TOKEN, scheme: 'basic' });
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath, entry.name));
  }
  return out;
}

test('VO-040 a saved secret is stored only in the keyring, one entry per platform under pr-review-workbench', async (t) => {
  const appData = await useTempAppData(t);
  const keyring = createFakeKeyring();
  const { store } = await makeStore(keyring);

  await saveAll(store);
  // Saving again replaces the platform's entry rather than adding one.
  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer' });

  const entries = keyring.entries();
  assert.deepEqual(
    entries.map((e) => [e.service, e.account]),
    [
      [SERVICE, 'bitbucket-cloud'],
      [SERVICE, 'github'],
      [SERVICE, 'jira-cloud'],
    ],
  );
  assert.ok(keyring.peek(SERVICE, 'github')?.includes(GITHUB_TOKEN));
  assert.ok(keyring.peek(SERVICE, 'bitbucket-cloud')?.includes(BITBUCKET_TOKEN));
  assert.ok(keyring.peek(SERVICE, 'jira-cloud')?.includes(JIRA_TOKEN));
  assert.ok(keyring.calls.every((c) => c.service === SERVICE), 'every keyring call uses the one service name');

  // A fresh module instance over the same keyring still has every credential: the keyring is the store.
  const { store: reloaded } = await makeStore(keyring);
  assert.equal(await reloaded.has('github'), true);
  assert.equal(await reloaded.has('bitbucket-cloud'), true);
  assert.equal(await reloaded.has('jira-cloud'), true);
  assert.equal(await reloaded.account('bitbucket-cloud'), 'reviewer@example.com');

  // Nothing was written to the app-data directory, so config.json and the logs cannot hold it.
  for (const path of await filesUnder(appData.root)) assertNoSecret(await readFile(path, 'utf8'), path);
});

test('VO-040 no credential API returns the secret', async () => {
  const keyring = createFakeKeyring();
  const { store } = await makeStore(keyring);

  const results: unknown[] = [];
  results.push(await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer' }));
  results.push(
    await store.save('bitbucket-cloud', { account: 'reviewer@example.com', secret: BITBUCKET_TOKEN, scheme: 'basic' }),
  );
  results.push(await store.save('jira-cloud', { account: 'reviewer@example.com', secret: JIRA_TOKEN, scheme: 'basic' }));
  for (const platform of ['github', 'bitbucket-cloud', 'jira-cloud', 'never-saved']) {
    results.push(await store.has(platform));
    results.push(await store.account(platform));
    results.push(store.authorize(platform));
  }

  assert.equal(await store.account('github'), 'octo-reviewer');
  assert.equal(await store.account('jira-cloud'), 'reviewer@example.com');
  assert.equal(await store.account('never-saved'), undefined);
  assert.equal(await store.has('never-saved'), false);

  results.forEach((value, i) => assertNoSecret(value, `result ${i}`));
  assertNoSecret(store, 'the credential store object');
  assertNoSecret(Object.keys(store), 'the credential store keys');

  results.push(await store.remove('github'));
  assertNoSecret(results.at(-1), 'remove result');
});

test('VO-040 authorize() adds the Authorization header for the platform', async () => {
  const keyring = createFakeKeyring();
  const { store } = await makeStore(keyring);
  await saveAll(store);

  const authorizeGithub = store.authorize('github');
  const gh = authorizeGithub(new Request('https://api.example.test/user', { headers: { Accept: 'application/json' } }));
  assert.ok(gh instanceof Request);
  assert.equal(gh.headers.get('authorization'), `Bearer ${GITHUB_TOKEN}`);
  assert.equal(gh.headers.get('accept'), 'application/json', 'existing headers are kept');
  assert.equal(gh.method, 'GET');
  assert.equal(gh.url, 'https://api.example.test/user');

  const bb = store.authorize('bitbucket-cloud')(new Request('https://api.example.test/2.0/user'));
  assert.equal(bb.headers.get('authorization'), basic('reviewer@example.com', BITBUCKET_TOKEN));

  const jira = store.authorize('jira-cloud')(new Request('https://site.example.test/rest/api/3/myself'));
  assert.equal(jira.headers.get('authorization'), basic('reviewer@example.com', JIRA_TOKEN));

  // A fresh instance reading the keyring authorizes the same way.
  const { store: reloaded } = await makeStore(keyring);
  const again = reloaded.authorize('jira-cloud')(new Request('https://site.example.test/rest/api/3/myself'));
  assert.equal(again.headers.get('authorization'), basic('reviewer@example.com', JIRA_TOKEN));

  // After removal the entry is gone from the keyring.
  await store.remove('github');
  assert.equal(keyring.peek(SERVICE, 'github'), undefined);
  assert.equal(await store.has('github'), false);
  assert.equal(await store.account('github'), undefined);
  assert.equal(await store.has('jira-cloud'), true);
});

test('VO-040 every loaded secret is registered with the log scrubber before it is used', async () => {
  const keyring = createFakeKeyring();

  // Saving registers the secret straight away.
  const first = await makeStore(keyring);
  await saveAll(first.store);
  for (const secret of ALL_SECRETS) assert.ok(first.registered.includes(secret), 'save registers the secret');

  // A fresh instance that loads secrets from the keyring registers each one before its header is built.
  const second = await makeStore(keyring);
  assert.equal(second.registered.length, 0, 'nothing is registered before anything is loaded');
  const order: string[] = [];
  for (const [platform, secret] of [
    ['github', GITHUB_TOKEN],
    ['bitbucket-cloud', BITBUCKET_TOKEN],
    ['jira-cloud', JIRA_TOKEN],
  ] as const) {
    const request = second.store.authorize(platform)(new Request('https://api.example.test/'));
    order.push(`${platform}:${second.registered.includes(secret)}`);
    assert.ok(request.headers.get('authorization'));
  }
  assert.deepEqual(order, ['github:true', 'bitbucket-cloud:true', 'jira-cloud:true']);
  for (const secret of ALL_SECRETS) assert.ok(second.registered.includes(secret));
});

test('VO-040 a keyring failure surfaces without the secret, and leaves no file holding it', async (t) => {
  const appData = await useTempAppData(t);
  const keyring = createFakeKeyring();
  const { store } = await makeStore(keyring);
  keyring.setUnavailable(new Error('The keychain is locked'));

  await assert.rejects(
    async () => {
      await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer' });
    },
    (error: unknown) => {
      assertNoSecret(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error), 'the error');
      return true;
    },
  );
  assert.deepEqual(keyring.entries(), []);

  keyring.setUnavailable(null);
  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer' });
  store.authorize('github')(new Request('https://api.example.test/user'));
  await store.remove('github');

  for (const path of await filesUnder(appData.root)) assertNoSecret(await readFile(path, 'utf8'), path);
});

// ---- T041 (specs/005-review-actions, R9, X.7, X.8): write scope is lazy ----
//
// API required from src/credentials.ts (T019), added to CredentialStore and CredentialInput:
//
//   CredentialInput gains `scope?: 'read' | 'write'` (default 'read'): what the sign-in was granted.
//   hasWriteScope(platform): Promise<boolean>   true only for a saved credential with scope 'write'.
//   authorizeForWrite(platform): Authorize      like authorize(), but throws
//       AdapterError('forbidden', platform, <message naming a sign-in with write access>) when the
//       platform has no credential or one without write scope. The message never holds a secret.
//
// authorize() (the read path) is unchanged and works with a read-only credential, so a sign-in never
// asks for write scope and the keyring is not touched for write scope until a write is attempted.

test('T041 a read sign-in does not carry write scope, and reading never needs it', async () => {
  const keyring = createFakeKeyring();
  const { store } = await makeStore(keyring);
  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer' });

  assert.equal(await store.hasWriteScope('github'), false);
  const request = store.authorize('github')(new Request('https://api.example.test/user'));
  assert.equal(request.headers.get('authorization'), `Bearer ${GITHUB_TOKEN}`);
});

test('T041 a write before write scope was granted maps to forbidden and sends nothing', async () => {
  const { AdapterError } = await import('../../src/contracts/shared.ts');
  const keyring = createFakeKeyring();
  const { store } = await makeStore(keyring);
  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer', scope: 'read' });

  for (const platform of ['github', 'gitlab']) {
    // 'gitlab' has no credential at all: also forbidden, not a thrown CredentialError.
    assert.throws(
      () => store.authorizeForWrite(platform)(new Request('https://api.example.test/x', { method: 'POST' })),
      (error: unknown) => {
        assert.ok(error instanceof AdapterError);
        assert.equal(error.code, 'forbidden');
        assert.equal(error.platform, platform);
        assertNoSecret(`${error.message}\n${error.stack ?? ''}`, 'the forbidden error');
        return true;
      },
    );
  }
});

test('T041 once write scope is granted the write authorize adds the header, and a later read sign-in does not keep it', async () => {
  const keyring = createFakeKeyring();
  const { store } = await makeStore(keyring);
  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer', scope: 'write' });

  assert.equal(await store.hasWriteScope('github'), true);
  const request = store.authorizeForWrite('github')(new Request('https://api.example.test/x', { method: 'POST' }));
  assert.equal(request.headers.get('authorization'), `Bearer ${GITHUB_TOKEN}`);

  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer' });
  assert.equal(await store.hasWriteScope('github'), false);
});

test('T041 no token reaches an X.7 location through the write-scope path', async (t) => {
  const appData = await useTempAppData(t);
  const keyring = createFakeKeyring();
  const { store, registered } = await makeStore(keyring);
  await store.save('github', { account: 'octo-reviewer', secret: GITHUB_TOKEN, scheme: 'bearer', scope: 'write' });
  await store.hasWriteScope('github');
  store.authorizeForWrite('github')(new Request('https://api.example.test/x', { method: 'POST' }));

  assert.ok(registered.includes(GITHUB_TOKEN), 'the secret was not registered with the scrubber');
  assertNoSecret(await store.account('github'), 'account()');
  assertNoSecret(await store.hasWriteScope('github'), 'hasWriteScope()');
  assertNoSecret(store, 'the credential store object');
  for (const path of await filesUnder(appData.root)) assertNoSecret(await readFile(path, 'utf8'), path);
});
