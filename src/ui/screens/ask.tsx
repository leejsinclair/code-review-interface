// Interrogation panel (`#/sessions/:sessionId/ask`, FR-013 to FR-021, FR-045 to FR-048, FR-051,
// FR-053): the current scope, the category, "Answer for" (Technical by default), the fixed suggested
// questions, the question box, and every question of the session with its state, its streamed raw
// text while in progress, its labelled claims, assumptions, follow-ups and provenance. Queued and
// running questions can be cancelled. All PR and AI text is rendered as text nodes (R7).

import { useEffect, useState } from 'preact/hooks';
import type { AnswerFor, Category, ProviderStatus, Question, Scope, Suggestion } from '../../contracts/http.ts';
import { askQuestion, cancelQuestion, getProvider, listQuestions, listSuggestions, subscribeSession } from '../api.ts';
import { AnswerWarning, ClaimsList, ContextVersion, RestrictionsNotEnforced } from '../components/claims.tsx';
import { ANSWER_FOR_LABEL, AUDIENCE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER, DEFAULT_AUDIENCE } from '../labels.ts';

/** The ask route for a scope, as hash query parameters. */
export function askHash(sessionId: string, scope: Scope): string {
  const query = new URLSearchParams({ type: scope.type });
  if (scope.type !== 'pr') query.set('path', scope.path);
  if (scope.type === 'range') {
    query.set('side', scope.side);
    query.set('start', String(scope.startLine));
    query.set('end', String(scope.endLine));
    if (scope.label !== undefined) query.set('label', scope.label);
  }
  return `#/sessions/${encodeURIComponent(sessionId)}/ask?${query.toString()}`;
}

/** The scope named by the ask route's query; the whole PR when it names none. */
export function scopeFromQuery(query: URLSearchParams): Scope {
  const path = query.get('path');
  const start = Number(query.get('start'));
  const end = Number(query.get('end'));
  const side = query.get('side');
  if (query.get('type') === 'range' && path !== null && (side === 'head' || side === 'base') && start >= 1 && end >= start) {
    const label = query.get('label');
    return { type: 'range', path, side, startLine: start, endLine: end, ...(label === null ? {} : { label }) };
  }
  if (query.get('type') === 'file' && path !== null) return { type: 'file', path };
  return { type: 'pr' };
}

export function scopeText(scope: Scope): string {
  if (scope.type === 'pr') return 'Scope: the whole PR';
  if (scope.type === 'file') return `Scope: file ${scope.path}`;
  const label = scope.label === undefined ? '' : ` "${scope.label}"`;
  return `Scope: ${scope.path} lines ${scope.startLine}-${scope.endLine} (${scope.side === 'head' ? 'new' : 'old'} side)${label}`;
}

function QuestionItem(props: { sessionId: string; question: Question; onFollowUp(q: Question, text: string): void; onCancel(q: Question): void }) {
  const { sessionId, question: q } = props;
  const a = q.answer;
  const open = q.state === 'queued' || q.state === 'in_progress';
  return (
    <li data-testid={`question-${q.questionId}`} data-state={q.state} data-head-commit={q.headCommit} class="panel stack">
      <p>
        <span class="chip">{CATEGORY_LABELS[q.category]}</span> <span class="chip">{AUDIENCE_LABELS[q.answerFor]}</span> <strong>{q.text}</strong>
      </p>
      <p class="muted">{`${scopeText(q.scope)} · ${q.state.replace('_', ' ')}`}</p>
      {!q.isLatestSnapshot && <p data-testid="older-snapshot-marker" class="warning">{`Answered for an earlier head commit ${q.headCommit}`}</p>}
      {open && (
        <button type="button" data-testid={`cancel-question-${q.questionId}`} onClick={() => props.onCancel(q)}>
          Cancel
        </button>
      )}
      {a !== undefined && q.state === 'in_progress' && (
        <pre data-testid="answer-raw-text" class="text-block in-progress">{`In progress, not yet checked:\n${a.rawText ?? ''}`}</pre>
      )}
      {a !== undefined && q.state !== 'in_progress' && (
        <div class="stack">
          {q.state === 'failed' && <p class="error">{`Failed: ${a.failureReason ?? 'the provider failed'}`}</p>}
          <AnswerWarning warning={a.warning} />
          <ClaimsList sessionId={sessionId} snapshotId={q.snapshotId} claims={a.claims} />
          {a.unsupportedAssumptions.length > 0 && (
            <section data-testid="unsupported-assumptions">
              <h4>Unsupported assumptions</h4>
              <ul class="list">
                {a.unsupportedAssumptions.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </section>
          )}
          {q.state === 'completed' && a.suggestedFollowUps.length > 0 && (
            <ul class="list">
              {a.suggestedFollowUps.map((text, i) => (
                <li key={i}>
                  <button type="button" data-testid="suggested-follow-up" onClick={() => props.onFollowUp(q, text)}>
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <RestrictionsNotEnforced ids={a.restrictionsNotEnforced} />
          <p data-testid="answer-provenance" class="muted">
            <span>{`${a.provider} · ${a.completedAt ?? ''} `}</span>
            <ContextVersion value={a.contextVersion} />
          </p>
        </div>
      )}
    </li>
  );
}

export function AskScreen(props: { sessionId: string; query: URLSearchParams }) {
  const { sessionId } = props;
  const scope = scopeFromQuery(props.query);
  const [category, setCategory] = useState<Category>('what');
  const [answerFor, setAnswerFor] = useState<AnswerFor>(DEFAULT_AUDIENCE);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = (): void => {
    listQuestions(sessionId)
      .then(setQuestions)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the questions.'));
  };

  useEffect(() => {
    reload();
    getProvider().then(setProvider).catch(() => undefined);
    const stream = subscribeSession(sessionId, {
      question: () => reload(),
      'answer-delta': (delta) =>
        setQuestions((list) =>
          list.map((q) =>
            q.questionId === delta.questionId && q.answer !== undefined ? { ...q, answer: { ...q.answer, rawText: `${q.answer.rawText ?? ''}${delta.text}` } } : q,
          ),
        ),
      onQuestions: setQuestions,
    });
    return () => stream.close();
  }, [sessionId]);

  useEffect(() => {
    listSuggestions(scope.type, category).then(setSuggestions).catch(() => setSuggestions([]));
  }, [scope.type, category]);

  const submit = (body: Parameters<typeof askQuestion>[1]): void => {
    setError(null);
    askQuestion(sessionId, body)
      .then(() => {
        setText('');
        reload();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'The question was refused.'));
  };
  const cancel = (q: Question): void => {
    cancelQuestion(sessionId, q.questionId)
      .then(reload)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not cancel.'));
  };

  return (
    <article class="stack">
      <section class="panel stack">
        <p data-testid="scope-indicator">{scopeText(scope)}</p>
        {provider !== null && !provider.available && (
          <p data-testid="provider-unavailable" class="warning">{`AI provider unavailable: ${provider.unavailableReason ?? 'unknown reason'}`}</p>
        )}
        <div class="row">
          {CATEGORY_ORDER.map((c) => (
            <label key={c}>
              <input type="radio" name="category" data-testid={`category-${c}`} checked={category === c} onChange={() => setCategory(c)} />
              {CATEGORY_LABELS[c]}
            </label>
          ))}
        </div>
        <div class="row">
          <span>{ANSWER_FOR_LABEL}</span>
          {(['technical', 'business'] as const).map((audience) => (
            <label key={audience}>
              <input type="radio" name="answer-for" data-testid={`answer-for-${audience}`} checked={answerFor === audience} onChange={() => setAnswerFor(audience)} />
              {AUDIENCE_LABELS[audience]}
            </label>
          ))}
        </div>
        <ul class="list">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button type="button" data-testid="suggested-question" onClick={() => setText(s.text)}>
                {s.text}
              </button>
            </li>
          ))}
        </ul>
        <textarea data-testid="question-input" value={text} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
        <button type="button" data-testid="ask-button" disabled={text.trim() === ''} onClick={() => submit({ scope, category, text, answerFor })}>
          Ask
        </button>
        {error !== null && <p class="error">{error}</p>}
      </section>
      <ul class="list stack">
        {[...questions].reverse().map((q) => (
          <QuestionItem
            key={q.questionId}
            sessionId={sessionId}
            question={q}
            onCancel={cancel}
            onFollowUp={(parent, followText) => submit({ scope: parent.scope, category: parent.category, text: followText, answerFor: parent.answerFor, followsQuestionId: parent.questionId })}
          />
        ))}
      </ul>
    </article>
  );
}
