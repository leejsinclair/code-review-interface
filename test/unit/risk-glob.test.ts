// T005 (RR-3, RR-4): the glob matcher used by the built-in rules and the rule file. Case-insensitive, on
// `/`-separated repository paths. `*` stays within a segment, `**` crosses segments, `?` is one character.
// A pattern with no `/` matches the file name at any depth. No regular expression is built from input.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_GLOB_LENGTH, matchGlob, validateGlob } from '../../src/core/risk/glob.ts';

test('* stays inside one path segment', () => {
  assert.equal(matchGlob('src/*.ts', 'src/a.ts'), true);
  assert.equal(matchGlob('src/*.ts', 'src/deep/a.ts'), false);
  assert.equal(matchGlob('src/a*', 'src/abc'), true);
  assert.equal(matchGlob('src/a*', 'src/b'), false);
});

test('** crosses segments, including none', () => {
  assert.equal(matchGlob('**/migrations/**', 'db/migrations/001.sql'), true);
  assert.equal(matchGlob('**/migrations/**', 'migrations/001.sql'), true);
  assert.equal(matchGlob('**/migrations/**', 'a/b/c/migrations/x/y.sql'), true);
  assert.equal(matchGlob('**/migrations/**', 'db/other/001.sql'), false);
  assert.equal(matchGlob('.github/workflows/**', '.github/workflows/ci.yml'), true);
});

test('? matches exactly one character', () => {
  assert.equal(matchGlob('a?c.ts', 'abc.ts'), true);
  assert.equal(matchGlob('a?c.ts', 'ac.ts'), false);
  assert.equal(matchGlob('a?c.ts', 'a/c.ts'), false);
});

test('matching is case-insensitive', () => {
  assert.equal(matchGlob('**/Migrations/**', 'DB/MIGRATIONS/x.sql'), true);
  assert.equal(matchGlob('Dockerfile*', 'dockerfile.prod'), true);
});

test('a pattern without a slash matches the file name at any depth', () => {
  assert.equal(matchGlob('package-lock.json', 'package-lock.json'), true);
  assert.equal(matchGlob('package-lock.json', 'web/package-lock.json'), true);
  assert.equal(matchGlob('*.lock', 'a/b/yarn.lock'), true);
  assert.equal(matchGlob('*.lock', 'a/yarn.lock.txt'), false);
});

test('a pattern with a slash is anchored at the repository root', () => {
  assert.equal(matchGlob('db/migrate/**', 'db/migrate/1.rb'), true);
  assert.equal(matchGlob('db/migrate/**', 'app/db/migrate/1.rb'), false);
});

test('patterns over 200 characters or malformed are rejected with a reason', () => {
  assert.equal(validateGlob('src/**/*.ts'), null);
  assert.match(validateGlob('a'.repeat(MAX_GLOB_LENGTH + 1)) ?? '', /200/);
  assert.match(validateGlob('') ?? '', /empty/i);
  assert.notEqual(validateGlob('a**b'), null);
  assert.notEqual(validateGlob('src\\win'), null);
  assert.notEqual(validateGlob('a\0b'), null);
  // A rejected pattern never matches.
  assert.equal(matchGlob('a**b', 'axxb'), false);
});

test('matching is linear: a hostile pattern and path finish at once', () => {
  const started = Date.now();
  matchGlob('*a*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(5000));
  matchGlob('**/**/**/**/**/x', 'a/'.repeat(400));
  assert.ok(Date.now() - started < 1000);
});

test('no regular expression is built from input', () => {
  const source = readFileSync(new URL('../../src/core/risk/glob.ts', import.meta.url), 'utf8');
  assert.equal(/new RegExp|RegExp\(/.test(source), false);
});
