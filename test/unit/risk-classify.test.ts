// T016 (VO-001 to VO-006, VO-009 to VO-012, VO-037): the pure rule-based classifier. Rules run first and are
// deterministic; the highest class wins and every matching rule is listed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFiles, type ClassifyFile } from '../../src/core/risk/classify.ts';
import { loadRuleset } from '../../src/core/risk/ruleset.ts';

const ruleset = loadRuleset();

const file = (path: string, patch: string | null, extra: Partial<ClassifyFile> = {}): ClassifyFile => ({
  path,
  oldPath: null,
  status: 'modified',
  additions: 1,
  deletions: 0,
  binary: false,
  sizeBytes: null,
  patch,
  excludedReason: null,
  ...extra,
});
const edit = (text: string): string => `@@ -1 +1,2 @@\n keep\n+${text}\n`;
const one = (f: ClassifyFile) => {
  const [c] = classifyFiles([f], ruleset);
  assert.ok(c);
  return c;
};
const ids = (c: ReturnType<typeof one>) => c.reasons.filter((r) => r.applied).map((r) => r.ruleId);

test('VO-001 a file matching two sensitive rules gets the higher class and lists both', () => {
  const c = one(file('src/payments/auth/guard.ts', edit('check();')));
  assert.equal(c.ruleClass, 'critical');
  assert.ok(ids(c).includes('R-AUTH') && ids(c).includes('R-FINANCE'), ids(c).join());
  const elevated = one(file('Dockerfile', edit('RUN make')));
  assert.equal(elevated.ruleClass, 'elevated');
});

test('VO-002 a behavioural change in a sensitive area is Critical; config is at least Elevated; a term alone is Elevated', () => {
  const critical: Array<[string, string]> = [
    ['src/auth/session.ts', 'R-AUTH'],
    ['src/authz/policy.ts', 'R-AUTHZ'],
    ['src/purge/jobs.ts', 'R-DELETE'],
    ['src/billing/total.ts', 'R-FINANCE'],
    ['db/migrations/001_add_users.sql', 'R-MIGRATION'],
  ];
  for (const [path, rule] of critical) {
    const c = one(file(path, edit('run();')));
    assert.equal(c.ruleClass, 'critical', path);
    assert.ok(ids(c).includes(rule), `${path} lists ${rule}`);
  }
  for (const path of ['.github/workflows/ci.yml', 'Dockerfile', 'infra/main.tf', 'deploy/k8s/app.yaml']) {
    const c = one(file(path, edit('x: 1')));
    assert.equal(c.ruleClass, 'elevated', path);
    assert.ok(ids(c).includes('R-CONFIG'));
  }
  const term = one(file('src/util/strings.ts', edit('const password = read();')));
  assert.equal(term.ruleClass, 'elevated');
  assert.deepEqual(ids(term), ['R-AUTH']);
  assert.equal(term.reasons[0]?.matchedOn, 'lines');
  assert.equal(term.reasons[0]?.lines.length, 1);
});

test('VO-003 classifying twice gives identical output', () => {
  const files = [file('src/auth/a.ts', edit('x();')), file('README.md', edit('hello')), file('db/migrations/1.sql', edit('ALTER TABLE a;'))];
  assert.deepEqual(classifyFiles(files, ruleset), classifyFiles(files, ruleset));
});

test('VO-004 a path-only match says so and records no lines', () => {
  const c = one(file('src/billing/total.ts', edit('run();')));
  const reason = c.reasons.find((r) => r.ruleId === 'R-FINANCE');
  assert.equal(reason?.matchedOn, 'path');
  assert.deepEqual(reason?.lines, []);
  assert.match(reason?.text ?? '', /path/i);
});

test('VO-005 a file no rule matches is Normal with a reason, the origin default and no rule ID', () => {
  const c = one(file('src/util/strings.ts', edit('const a = 1;')));
  assert.equal(c.ruleClass, 'normal');
  assert.equal(c.mechanical, false);
  assert.equal(c.reasons.length, 1);
  assert.equal(c.reasons[0]?.ruleId, 'DEFAULT');
  assert.match(c.reasons[0]?.text ?? '', /No mandatory-scrutiny rule matched/);
});

test('VO-006 a comment-only edit in an auth and a migration file is Low, R-COMMENT-ONLY, naming the rule not applied', () => {
  for (const [path, rule] of [['src/auth/session.ts', 'R-AUTH'], ['db/migrations/1.sql', 'R-MIGRATION']] as const) {
    const c = one(file(path, path.endsWith('.sql') ? edit('-- a note') : edit('// a note')));
    assert.equal(c.ruleClass, 'low', path);
    assert.equal(c.mechanical, true);
    assert.deepEqual(ids(c), ['R-COMMENT-ONLY']);
    const skipped = c.reasons.find((r) => r.ruleId === rule);
    assert.equal(skipped?.applied, false, `${rule} is recorded as not applied`);
    assert.match(skipped?.text ?? '', /not applied|was not/i);
  }
});

test('VO-007 a behavioural change in an unknown extension is never comment-only', () => {
  const c = one(file('src/auth/x.weird', edit('// still code')));
  assert.equal(c.ruleClass, 'critical');
});

test('VO-009 an added and a deleted file in a sensitive area are behavioural; a deleted migration is Critical', () => {
  const added = one(file('src/auth/new.ts', '@@ -0,0 +1 @@\n+// only a comment\n', { status: 'added' }));
  assert.equal(added.ruleClass, 'critical');
  const deleted = one(file('db/migrations/001.sql', '@@ -1 +0,0 @@\n--- gone\n', { status: 'deleted', additions: 0, deletions: 1 }));
  assert.equal(deleted.ruleClass, 'critical');
  assert.ok(ids(deleted).includes('R-MIGRATION'));
});

test('VO-010 a pure rename is Low and mechanical; a rename into or out of a sensitive path is Elevated', () => {
  const pure = one(file('src/util/names.ts', '', { status: 'renamed', oldPath: 'src/util/name.ts', additions: 0, deletions: 0 }));
  assert.equal(pure.ruleClass, 'low');
  assert.equal(pure.mechanical, true);
  assert.deepEqual(ids(pure), ['R-RENAME-ONLY']);
  const into = one(file('src/auth/names.ts', '', { status: 'renamed', oldPath: 'src/util/name.ts', additions: 0, deletions: 0 }));
  assert.equal(into.ruleClass, 'elevated');
  assert.equal(into.mechanical, false);
  const out = one(file('src/util/name.ts', '', { status: 'renamed', oldPath: 'src/auth/names.ts', additions: 0, deletions: 0 }));
  assert.equal(out.ruleClass, 'elevated');
});

test('VO-011 a lockfile and a generated file are Low and mechanical; one in a sensitive path keeps that class', () => {
  const lock = one(file('package-lock.json', edit('"x": 1')));
  assert.equal(lock.ruleClass, 'low');
  assert.equal(lock.mechanical, true);
  assert.deepEqual(ids(lock), ['R-LOCKFILE']);
  const generated = one(file('src/api/client.generated.ts', edit('export const x = 1;')));
  assert.equal(generated.ruleClass, 'low');
  assert.deepEqual(ids(generated), ['R-GENERATED']);
  const marked = one(file('src/api/client.ts', '@@ -1,2 +1,3 @@\n // @generated by tool\n keep\n+export const x = 1;\n'));
  assert.equal(marked.ruleClass, 'low');
  assert.deepEqual(ids(marked), ['R-GENERATED']);
  const inAuth = one(file('src/auth/yarn.lock', edit('x')));
  assert.equal(inAuth.ruleClass, 'critical');
  assert.equal(inAuth.mechanical, false);
});

test('VO-012 a binary and a limit-skipped file are never below Normal and are flagged not fully analysed', () => {
  const binary = one(file('assets/logo.png', null, { binary: true, excludedReason: 'binary' }));
  assert.equal(binary.ruleClass, 'normal');
  assert.equal(binary.notFullyAnalysed, 'binary');
  assert.equal(binary.mechanical, false);
  const big = one(file('package-lock.json', null, { excludedReason: 'file size', sizeBytes: 9_999_999 }));
  assert.equal(big.ruleClass, 'normal', 'a skipped lockfile is not mechanical');
  assert.equal(big.notFullyAnalysed, 'file size');
  const sensitive = one(file('db/migrations/big.sql', null, { excludedReason: 'changed lines', additions: 9000 }));
  assert.equal(sensitive.ruleClass, 'critical', 'path rules still apply');
  assert.equal(sensitive.notFullyAnalysed, 'changed lines');
  assert.equal(sensitive.reasons.find((r) => r.ruleId === 'R-MIGRATION')?.matchedOn, 'path');
});

test('VO-037 only paths and the changed lines of the changed files are read', () => {
  const allowed = new Set(['path', 'oldPath', 'status', 'additions', 'deletions', 'binary', 'sizeBytes', 'patch', 'excludedReason']);
  const touched = new Set<string>();
  const spy = new Proxy(file('src/auth/a.ts', edit('x();')), {
    get(target, key, receiver) {
      if (typeof key === 'string') touched.add(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  classifyFiles([spy], ruleset);
  for (const key of touched) assert.ok(allowed.has(key), `reads only declared fields, read ${key}`);
});

test('reason text carries no text from the pull request', () => {
  const c = one(file('docs/<img src=x onerror=alert(1)>.md', edit('hello')));
  for (const r of c.reasons) assert.equal(r.text.includes('<img'), false);
  const auth = one(file('src/auth/<b>x</b>.ts', edit('run();')));
  for (const r of auth.reasons) assert.equal(r.text.includes('<b>'), false);
});

test('a classification carries the change fingerprint', () => {
  assert.match(one(file('src/a.ts', edit('x'))).changeFingerprint, /^[0-9a-f]{64}$/);
});

test('CI definitions are recognised by shape, for any platform', () => {
  for (const path of ['.github/workflows/ci.yml', '.gitea/workflows/build.yml', '.gitlab-ci.yml', 'bitbucket-pipelines.yml', 'azure-pipelines.yml', 'Jenkinsfile']) {
    assert.equal(one(file(path, edit('x: 1'))).ruleClass, 'elevated', path);
  }
});

test('a behavioural change in a test file under a sensitive path is Normal, with the rule listed as not applied', () => {
  for (const path of ['test/auth/login.test.ts', 'src/auth/session.test.ts', 'db/migrations/__tests__/001.ts', 'src/billing/total_test.go']) {
    const c = one(file(path, edit('run();')));
    assert.equal(c.ruleClass, 'normal', path);
    assert.ok(ids(c).includes('R-TEST'), `${path} names R-TEST`);
    assert.ok(c.reasons.some((r) => !r.applied && r.ruleId !== 'R-TEST'), `${path} lists the capped rule as not applied`);
  }
});

test('a term in a test file is Normal; a non-test file is unchanged', () => {
  const t = one(file('test/util/strings.test.ts', edit("db.run('delete from users'); const password = 'x';")));
  assert.equal(t.ruleClass, 'normal');
  assert.equal(one(file('src/util/strings.ts', edit('const password = read();'))).ruleClass, 'elevated');
  assert.equal(one(file('src/auth/session.ts', edit('run();'))).ruleClass, 'critical');
});

test('a binary test fixture under a sensitive path is Normal, not fully analysed', () => {
  const c = one(file('src/auth/__tests__/key.bin', null, { binary: true, additions: 0 }));
  assert.equal(c.ruleClass, 'normal');
  assert.equal(c.notFullyAnalysed, 'binary');
});

test('a test file renamed into a sensitive path is Low and mechanical; a comment-only test edit stays Low', () => {
  const r = one(file('src/auth/a.test.ts', null, { status: 'renamed', oldPath: 'src/a.test.ts', additions: 0 }));
  assert.equal(r.ruleClass, 'low');
  assert.equal(r.mechanical, true);
  assert.equal(one(file('test/auth/a.test.ts', '@@ -1 +1,2 @@\n keep\n+// note\n')).ruleClass, 'low');
});

test('a rule-file path lifts a test file; a rule-file line term alone does not', async () => {
  const { rulesetFromText } = await import('../../src/core/risk/ruleset.ts');
  const rs = rulesetFromText(
    JSON.stringify({
      version: 1,
      entries: [
        { add: 'X-PAY', family: 'financial', class: 'critical', paths: ['test/payments/**'] },
        { extend: 'R-AUTH', paths: ['test/login-flow/**'], lineTerms: ['secret_token'] },
      ],
    }),
  );
  const run = (path: string, text: string) => classifyFiles([file(path, edit(text))], rs)[0]!;
  assert.equal(run('test/payments/charge.test.ts', 'x();').ruleClass, 'critical');
  assert.equal(run('test/login-flow/a.test.ts', 'x();').ruleClass, 'critical');
  assert.equal(run('test/other/a.test.ts', 'const secret_token = 1;').ruleClass, 'normal');
});
