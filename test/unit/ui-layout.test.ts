// T006 (R6): width bands.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bandFor, BAND_QUERIES } from '../../src/ui/state/layout.ts';

test('bandFor splits at 900 and 1200', () => {
  assert.equal(bandFor(899), 'narrow');
  assert.equal(bandFor(900), 'medium');
  assert.equal(bandFor(1199), 'medium');
  assert.equal(bandFor(1200), 'wide');
});

test('BAND_QUERIES holds the three media queries', () => {
  assert.equal(BAND_QUERIES.wide, '(width >= 1200px)');
  assert.equal(BAND_QUERIES.medium, '(900px <= width < 1200px)');
  assert.equal(BAND_QUERIES.narrow, '(width < 900px)');
});
