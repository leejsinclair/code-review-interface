// Ask form (contracts 4.6), used by the full page and the Ask panel: a labelled question field, Category and
// Answer for as fieldsets, an Ask button that stays focusable and says why when it is unavailable, and
// submit errors linked to their field. Draft, category, Answer for and scope live in per-tab view state.

import { useContext, useEffect, useState } from 'preact/hooks';
import type { AnswerFor, Category, ProviderStatus, Scope, SessionSummary, Suggestion } from '../../contracts/http.ts';
import { askQuestion, getProvider, getSession, listSuggestions } from '../api.ts';
import { ASK_FORM_LABELS, AUDIENCE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER } from '../labels.ts';
import { ReviewContext } from '../state/review-context.ts';
import { readSession, writeSession } from '../state/view-state.ts';
import { AsyncRegion } from './async-region.tsx';

export function scopeText(scope: Scope): string {
  if (scope.type === 'pr') return 'Scope: the whole PR';
  if (scope.type === 'file') return `Scope: file ${scope.path}`;
  const label = scope.label === undefined ? '' : ` "${scope.label}"`;
  return `Scope: ${scope.path} lines ${scope.startLine}-${scope.endLine} (${scope.side === 'head' ? 'new' : 'old'} side)${label}`;
}

const message = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

export type AskComposerProps = {
  sessionId: string;
  /** The scope the page was opened with; when absent the stored scope is used. */
  scope?: Scope | undefined;
  /** Called after a question was accepted. */
  onAsked?: () => void;
  /** For a follow-up asked from the thread. */
  idPrefix?: string;
};

export function AskComposer({ sessionId, scope: given, onAsked, idPrefix = '' }: AskComposerProps) {
  const ctx = useContext(ReviewContext);
  const stored = readSession(sessionId);
  const [text, setText] = useState(stored.draft);
  const [category, setCategory] = useState<Category>(stored.category);
  const [answerFor, setAnswerFor] = useState<AnswerFor>(stored.answerFor);
  const scope: Scope = given ?? stored.scope;
  const [fetched, setFetched] = useState<SessionSummary | undefined>(undefined);
  const session: SessionSummary | undefined = ctx.session ?? fetched;
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState({ provider: 0, suggestions: 0 });

  useEffect(() => {
    if (given !== undefined) writeSession(sessionId, { scope: given });
  }, [sessionId, given === undefined ? '' : JSON.stringify(given)]);

  useEffect(() => {
    if (ctx.session === undefined) getSession(sessionId).then(setFetched).catch(() => undefined);
  }, [sessionId, ctx.session]);

  useEffect(() => {
    setProvider(null);
    setProviderError(null);
    getProvider().then(setProvider).catch((e: unknown) => setProviderError(message(e, 'The provider check failed.')));
  }, [tries.provider]);

  useEffect(() => {
    setSuggestions(null);
    setSuggestionsError(null);
    listSuggestions(scope.type, category).then(setSuggestions).catch((e: unknown) => setSuggestionsError(message(e, 'Could not load suggestions.')));
  }, [scope.type, category, tries.suggestions]);

  const reason =
    session?.readOnly === true
      ? `This pull request is ${session.prStatus}, so questions cannot be added.`
      : session !== undefined && !session.repositoryAvailable
        ? (session.repositoryReason ?? 'The repository is no longer found under the base folder.')
        : provider !== null && !provider.available
          ? `The AI provider is unavailable: ${provider.unavailableReason ?? 'unknown reason'}.`
          : text.trim() === ''
            ? 'Enter a question first.'
            : null;

  const update = (patch: Parameters<typeof writeSession>[1]): void => writeSession(sessionId, patch);
  const submit = (): void => {
    if (reason !== null) return;
    setError(null);
    askQuestion(sessionId, { scope, category, text, answerFor })
      .then(() => {
        setText('');
        update({ draft: '' });
        onAsked?.();
      })
      .catch((e: unknown) => setError(message(e, 'The question was refused.')));
  };

  const id = (name: string): string => `${idPrefix}${name}`;
  return (
    <form class="panel stack ask-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p data-testid="scope-indicator">{scopeText(scope)}</p>
      <AsyncRegion
        region="provider"
        label="the AI provider check"
        {...(providerError !== null ? ({ state: 'failed', reason: providerError, retry: () => setTries((t) => ({ ...t, provider: t.provider + 1 })) } as const) : provider === null ? ({ state: 'loading' } as const) : ({ state: 'loaded' } as const))}
      >
        {provider !== null && !provider.available && <p data-testid="provider-unavailable" class="warning">{`AI provider unavailable: ${provider.unavailableReason ?? 'unknown reason'}`}</p>}
      </AsyncRegion>
      <fieldset>
        <legend>{ASK_FORM_LABELS.category}</legend>
        {CATEGORY_ORDER.map((c) => (
          <label key={c}>
            <input
              type="radio"
              name={id('category')}
              data-testid={`category-${c}`}
              checked={category === c}
              onChange={() => {
                setCategory(c);
                update({ category: c });
              }}
            />
            {CATEGORY_LABELS[c]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{ASK_FORM_LABELS.answerFor}</legend>
        {(['technical', 'business'] as const).map((a) => (
          <label key={a}>
            <input
              type="radio"
              name={id('answer-for')}
              data-testid={`answer-for-${a}`}
              checked={answerFor === a}
              onChange={() => {
                setAnswerFor(a);
                update({ answerFor: a });
              }}
            />
            {AUDIENCE_LABELS[a]}
          </label>
        ))}
      </fieldset>
      <AsyncRegion
        region="suggestions"
        label="suggested questions"
        {...(suggestionsError !== null ? ({ state: 'failed', reason: suggestionsError, retry: () => setTries((t) => ({ ...t, suggestions: t.suggestions + 1 })) } as const) : suggestions === null ? ({ state: 'loading' } as const) : ({ state: 'loaded' } as const))}
      >
        <ul class="list">
          {(suggestions ?? []).map((s, i) => (
            <li key={i}>
              <button
                type="button"
                data-testid="suggested-question"
                onClick={() => {
                  setText(s.text);
                  update({ draft: s.text });
                }}
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      </AsyncRegion>
      <label for={id('question-input')}>{ASK_FORM_LABELS.question}</label>
      <textarea
        id={id('question-input')}
        data-testid="question-input"
        value={text}
        {...(error !== null ? { 'aria-invalid': 'true', 'aria-describedby': 'ask-error' } : {})}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLTextAreaElement).value;
          setText(v);
          update({ draft: v });
        }}
      />
      <button type="submit" id={id('ask-button')} data-testid="ask-button" aria-disabled={reason !== null ? 'true' : undefined} aria-describedby={reason !== null ? 'ask-unavailable-reason' : undefined}>
        Ask
      </button>
      {reason !== null && (
        <p id="ask-unavailable-reason" data-testid="ask-unavailable-reason" class="muted">
          {reason}
        </p>
      )}
      {error !== null && (
        <p id="ask-error" data-testid="ask-error" role="alert" class="error">
          {error}
        </p>
      )}
    </form>
  );
}
