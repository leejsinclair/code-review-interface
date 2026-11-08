// VO-047 (FR-033): over HTTP, the diff of each changed file of a snapshot (added, modified, renamed
// and deleted) comes with its status, lines added and removed, and hunks; a binary file comes back
// `binary` with no hunks.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWorkbench } from '../helpers/fake-ai-cli.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const APP = `${Array.from({ length: 80 }, (_, i) => `export const value${i + 1} = ${i + 1};`).join('\n')}\n`;

test('VO-047 the diff route returns status, counts and hunks for added, modified, renamed and deleted files, and binary with no hunks', async (t) => {
  const bench = await startWorkbench(t, {
    prFiles: {
      'src/new.js': 'export const added = true;\nexport const more = 1;\n',
      'src/util.js': 'export function add(a, b) {\n  return a + b + 0;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
      'src/app.js': null,
      'src/main.js': APP,
      'README.md': null,
      'assets/logo.bin': 'PNG\u0000\u0001\u0002binary\u0000data',
    },
  });
  const detail = await bench.startSession();
  const sessionId = detail.sessionId as string;
  const snapshotId = detail.snapshots[0].snapshotId as string;
  const base = `/api/sessions/${sessionId}/snapshots/${snapshotId}`;

  const snapshot = (await bench.client.get(base)).json as Json;
  const byPath = new Map((snapshot.files as Json[]).map((f) => [f.path, f]));
  assert.equal(byPath.get('src/new.js')?.status, 'added');
  assert.equal(byPath.get('src/util.js')?.status, 'modified');
  assert.equal(byPath.get('src/main.js')?.status, 'renamed');
  assert.equal(byPath.get('src/main.js')?.previousPath, 'src/app.js');
  assert.equal(byPath.get('README.md')?.status, 'deleted');

  const diff = async (path: string): Promise<Json> => {
    const res = await bench.client.get(`${base}/diff?path=${encodeURIComponent(path)}`);
    assert.equal(res.status, 200, `${path}: ${res.text}`);
    return res.json as Json;
  };

  const added = await diff('src/new.js');
  assert.equal(added.path, 'src/new.js');
  assert.equal(added.binary, false);
  assert.equal(added.status, 'added');
  assert.equal(added.linesAdded, 2);
  assert.equal(added.linesRemoved, 0);
  assert.equal(added.hunks.length, 1);
  assert.deepEqual(added.hunks[0].lines.map((l: Json) => [l.type, l.newLine, l.text]), [
    ['add', 1, 'export const added = true;'],
    ['add', 2, 'export const more = 1;'],
  ]);

  const modified = await diff('src/util.js');
  assert.equal(modified.status, 'modified');
  assert.equal(modified.linesAdded, 1);
  assert.equal(modified.linesRemoved, 1);
  const changed = (modified.hunks as Json[]).flatMap((h) => h.lines).filter((l: Json) => l.type !== 'context');
  assert.deepEqual(changed.map((l: Json) => [l.type, l.oldLine ?? null, l.newLine ?? null, l.text]), [
    ['remove', 2, null, '  return a + b;'],
    ['add', null, 2, '  return a + b + 0;'],
  ]);

  const renamed = await diff('src/main.js');
  assert.equal(renamed.status, 'renamed');
  assert.equal(renamed.previousPath, 'src/app.js');
  assert.equal(renamed.linesAdded, 0);
  assert.equal(renamed.linesRemoved, 0);
  assert.deepEqual(renamed.hunks, [], 'a pure rename has no hunks');

  const deleted = await diff('README.md');
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.linesAdded, 0);
  assert.equal(deleted.linesRemoved, 3);
  assert.ok((deleted.hunks as Json[]).flatMap((h) => h.lines).every((l: Json) => l.type === 'remove' && l.oldLine >= 1));

  const binary = await diff('assets/logo.bin');
  assert.equal(binary.binary, true);
  assert.deepEqual(binary.hunks, []);

  const missing = await bench.client.get(`${base}/diff?path=${encodeURIComponent('src/not-changed.js')}`);
  assert.equal(missing.status, 404);
  assert.equal((missing.json as Json).error.code, 'not_found');
  const noPath = await bench.client.get(`${base}/diff`);
  assert.equal(noPath.status, 400);
  assert.equal((noPath.json as Json).error.code, 'invalid_request');
});
