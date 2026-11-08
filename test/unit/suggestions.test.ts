// VO-030 (FR-015): suggested questions are fixed templates that depend on the scope type, and each
// scope's set covers every category.

import assert from 'node:assert/strict';
import { test } from 'node:test';

const CATEGORIES = ['what', 'why', 'how', 'whatif', 'risk', 'requirement'] as const;
const SCOPES = ['pr', 'file', 'range'] as const;

test('VO-030 pr, file and range scopes each return their own fixed templates, covering every category', async () => {
  const { suggestionsFor } = await import('../../src/core/suggestions.ts');

  const byScope = new Map<string, string[]>();
  for (const scope of SCOPES) {
    const all = suggestionsFor(scope);
    assert.ok(all.length >= CATEGORIES.length, `${scope}: at least one template per category`);
    for (const category of CATEGORIES) {
      const some = suggestionsFor(scope, category);
      assert.ok(some.length >= 1, `${scope} has a ${category} template`);
      for (const s of some) {
        assert.equal(s.category, category);
        assert.equal(typeof s.text, 'string');
        assert.ok(s.text.trim().length > 0);
      }
      assert.deepEqual(
        some,
        all.filter((s) => s.category === category),
        `${scope}/${category} is the category's slice of the scope's set`,
      );
    }
    assert.deepEqual(suggestionsFor(scope), all, 'fixed: the same templates every time');
    byScope.set(scope, all.map((s) => `${s.category}:${s.text}`));
  }

  const [pr, file, range] = SCOPES.map((s) => new Set(byScope.get(s)));
  for (const [a, b, names] of [[pr, file, 'pr/file'], [pr, range, 'pr/range'], [file, range, 'file/range']] as const) {
    assert.ok([...a!].some((text) => !b!.has(text)), `${names}: each scope has templates of its own`);
  }
});
