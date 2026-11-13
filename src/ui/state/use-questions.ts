// The session's questions, loaded once and kept live: a `question` event reloads the list, `answer-delta` appends
// to the streamed text and a reconnect replaces the list. Shared by the Ask page and the Files view's notes.

import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import type { Question } from '../../contracts/http.ts';
import { listQuestions } from '../api.ts';
import { createAnnouncer } from './announcer.ts';
import { ReviewContext } from './review-context.ts';

export type QuestionsState = {
  questions: Question[] | null;
  error: string | null;
  reload(): void;
  retry(): void;
};

export function useQuestions(sessionId: string): QuestionsState {
  const ctx = useContext(ReviewContext);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const announcer = useMemo(() => createAnnouncer(ctx.announce, { intervalMs: 2000 }), [ctx.announce]);

  const reload = (): void => {
    listQuestions(sessionId)
      .then((list) => {
        setQuestions(list);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the questions.'));
  };

  useEffect(() => {
    reload();
    return ctx.subscribe({
      question: (q) => {
        if (q.state === 'completed') announcer.done();
        reload();
      },
      'answer-delta': (delta) => {
        setQuestions((list) =>
          (list ?? []).map((q) => {
            if (q.questionId !== delta.questionId || q.answer === undefined) return q;
            const rawText = `${q.answer.rawText ?? ''}${delta.text}`;
            announcer.stream(rawText);
            return { ...q, answer: { ...q.answer, rawText } };
          }),
        );
      },
      onQuestions: setQuestions,
    });
  }, [sessionId, attempt]);

  return { questions, error, reload, retry: () => setAttempt((n) => n + 1) };
}
