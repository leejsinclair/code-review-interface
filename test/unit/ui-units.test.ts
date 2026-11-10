import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LIMITS } from '../../src/core/limits.ts';
import { formatBytes, formatLines, parseKilobytes } from '../../src/ui/state/units.ts';

test('formatBytes shows whole KB', () => {
  assert.equal(formatBytes(1_048_576), '1024 KB');
  assert.equal(formatBytes(1536), '2 KB');
  assert.equal(formatBytes(100), '1 KB');
});

test('parseKilobytes accepts whole KB of 1 or more only', () => {
  assert.equal(parseKilobytes('1024'), 1_048_576);
  assert.equal(parseKilobytes(' 2 KB '), 2048);
  for (const bad of ['0', '-1', '1.5', '', 'abc', '1e3']) assert.equal(parseKilobytes(bad), null, bad);
});

test('formatLines groups thousands', () => {
  assert.equal(formatLines(5000), '5,000');
  assert.equal(formatLines(400000), '400,000');
});

test('every default round-trips unchanged', () => {
  assert.equal(parseKilobytes(formatBytes(DEFAULT_LIMITS.maxFileBytes)), DEFAULT_LIMITS.maxFileBytes);
  assert.equal(Number(formatLines(DEFAULT_LIMITS.maxChangedLines).replaceAll(',', '')), DEFAULT_LIMITS.maxChangedLines);
  assert.equal(Number(formatLines(DEFAULT_LIMITS.maxPromptChars).replaceAll(',', '')), DEFAULT_LIMITS.maxPromptChars);
});
