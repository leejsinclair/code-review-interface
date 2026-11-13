// Questions page (`#/sessions/:sessionId/ask`, FR-012, FR-028, FR-031, FR-044): the Ask form and every question of
// the session with its state, streamed text while in progress, labelled claims, assumptions, follow-ups and
// provenance. Queued and running questions can be cancelled. All PR and AI text is rendered as text nodes (R7).

import { useState } from 'preact/hooks';
import type { Question } from '../../contracts/http.ts';
import { askQuestion, cancelQuestion } from '../api.ts';
import { AskComposer, scopeText } from '../components/ask-composer.tsx';
import { AsyncRegion } from '../components/async-region.tsx';
import { Badge } from '../components/badge.tsx';
import { AnswerWarning, ClaimsList, ContextVersion, RestrictionsNotEnforced } from '../components/claims.tsx';
import { AUDIENCE_LABELS, CATEGORY_LABELS } from '../labels.ts';
import { useQuestions } from '../state/use-questions.ts';
import { scopeFromQuery } from '../state/routes.ts';

export function QuestionItem(props: { sessionId: string; question: Question; onFollowUp(q: Question, text: string): void; onCancel(q: Question): void }) {
  const { sessionId, question: q } = props;
  const a = q.answer;
  const open = q.state === 'queued' || q.state === 'in_progress';
  return (
    <li data-testid={`question-${q.questionId}`} data-state={q.state} data-head-commit={q.headCommit} class="panel stack">
      <p>
        <span class="chip">{CATEGORY_LABELS[q.category]}</span> <span class="chip">{AUDIENCE_LABELS[q.answerFor]}</span> <strong>{q.text}</strong>
      </p>
      <p class="muted">{`${scopeText(q.scope)} · ${q.state.replace('_', ' ')}`}</p>
      {!q.isLatestSnapshot && (
        <p data-testid="older-snapshot-marker">
          <Badge kind="older-head" commit={q.headCommit} />
        </p>
      )}
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
  const explicit = props.query.size > 0 ? scopeFromQuery(props.query) : undefined;
  const { questions, error: loadError, reload, retry } = useQuestions(sessionId);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? loadError;

  const submitFollowUp = (q: Question, text: string): void => {
    askQuestion(sessionId, { scope: q.scope, category: q.category, text, answerFor: q.answerFor, followsQuestionId: q.questionId })
      .then(() => (setError(null), reload()))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'The question was refused.'));
  };
  const cancel = (q: Question): void => {
    cancelQuestion(sessionId, q.questionId)
      .then(() => (setError(null), reload()))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not cancel.'));
  };

  const state =
    questions === null
      ? shownError !== null
        ? ({ state: 'failed', reason: shownError, retry } as const)
        : ({ state: 'loading' } as const)
      : questions.length === 0
        ? ({ state: 'empty', explanation: 'No questions yet.', nextStep: 'Ask one above.' } as const)
        : ({ state: 'loaded' } as const);

  return (
    <article class="stack">
      <h1>Questions</h1>
      <AskComposer sessionId={sessionId} scope={explicit} onAsked={reload} />
      <AsyncRegion region="questions" label="the questions" {...state}>
        <ul class="list stack">
          {[...(questions ?? [])].reverse().map((q) => (
            <QuestionItem key={q.questionId} sessionId={sessionId} question={q} onCancel={cancel} onFollowUp={submitFollowUp} />
          ))}
        </ul>
      </AsyncRegion>
    </article>
  );
}
