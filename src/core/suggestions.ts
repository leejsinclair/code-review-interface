// Fixed suggested-question templates per scope type and category (FR-015, Phase 1).

import type { Category, ScopeType, Suggestion } from '../contracts/http.ts';

const TEMPLATES: Readonly<Record<ScopeType, Readonly<Record<Category, readonly string[]>>>> = {
  pr: {
    what: ['What does this pull request change, in one paragraph?', 'What behaviour is different after this change?'],
    why: ['Why is this change being made?'],
    how: ['How does the change achieve its goal?'],
    whatif: ['What if this change is deployed and later rolled back?'],
    risk: ['What could break because of this change?', 'Which parts of the change carry the most risk?'],
    requirement: ['Which requirements in the linked issues does this change address?', 'Is any requirement in the linked issues not addressed?'],
  },
  file: {
    what: ['What changed in this file?'],
    why: ['Why was this file changed?'],
    how: ['How do the changes in this file fit the rest of the pull request?'],
    whatif: ['What if a caller of this file relies on its previous behaviour?'],
    risk: ['What could break because of the changes in this file?'],
    requirement: ['Which requirement does the change to this file serve?'],
  },
  range: {
    what: ['What does this code do?'],
    why: ['Why were these lines changed?'],
    how: ['How does this code handle its edge cases?'],
    whatif: ['What if the input to this code is empty or missing?'],
    risk: ['What could go wrong in these lines?'],
    requirement: ['Which requirement do these lines implement?'],
  },
};

const CATEGORY_ORDER: readonly Category[] = ['what', 'why', 'how', 'whatif', 'risk', 'requirement'];

/** The fixed templates for `scope`, optionally only those of `category`, in category order. */
export function suggestionsFor(scope: ScopeType, category?: Category): Suggestion[] {
  const categories = category === undefined ? CATEGORY_ORDER : [category];
  return categories.flatMap((c) => TEMPLATES[scope][c].map((text) => ({ text, category: c })));
}
