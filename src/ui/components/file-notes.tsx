// Notes for one file in the Files view: the AI explanation from the overview, an Ask form that is always there
// (scoped to the selection, else the file), and the questions asked about this file. A new question joins the list
// as soon as the server announces it. All AI text is rendered as text nodes (R7).

import { useContext, useState } from 'preact/hooks';
import type { Scope } from '../../contracts/http.ts';
import { askQuestion, cancelQuestion } from '../api.ts';
import { QuestionItem } from '../screens/ask.tsx';
import { ReviewContext } from '../state/review-context.ts';
import { useQuestions } from '../state/use-questions.ts';
import { AskComposer } from './ask-composer.tsx';
import { FileExplanation, SummariesProvider } from './summaries.tsx';

export function FileNotes(props: { sessionId: string; path: string; scope: Scope; selected: boolean }) {
  const { sessionId, path, scope, selected } = props;
  const { session } = useContext(ReviewContext);
  const { questions, error, reload } = useQuestions(sessionId);
  const [actionError, setActionError] = useState<string | null>(null);
  const fail = (fallback: string) => (e: unknown): void => setActionError(e instanceof Error ? e.message : fallback);
  const mine = (questions ?? []).filter((q) => q.scope.type !== 'pr' && q.scope.path === path).reverse();

  const followUp = (q: (typeof mine)[number], text: string): void => {
    askQuestion(sessionId, { scope: q.scope, category: q.category, text, answerFor: q.answerFor, followsQuestionId: q.questionId }).then(() => (setActionError(null), reload())).catch(fail('The question was refused.'));
  };
  const cancel = (q: (typeof mine)[number]): void => {
    cancelQuestion(sessionId, q.questionId).then(() => (setActionError(null), reload())).catch(fail('Could not cancel.'));
  };

  return (
    <section class="panel stack file-notes" data-testid="file-notes" aria-label="Notes for this file">
      <h2>AI notes</h2>
      {session === undefined ? (
        <p class="muted">Loading the notes…</p>
      ) : (
        <SummariesProvider sessionId={sessionId} detail={session}>
          <FileExplanation sessionId={sessionId} path={path} />
        </SummariesProvider>
      )}
      <h3>{selected ? 'Ask about the selection' : 'Ask about this file'}</h3>
      <AskComposer sessionId={sessionId} scope={scope} onAsked={reload} idPrefix="notes-" persistScope={false} />
      {(actionError ?? error) !== null && <p class="error" role="alert">{actionError ?? error}</p>}
      {mine.length > 0 && (
        <>
          <h3>Questions about this file</h3>
          <ul class="list stack" data-testid="file-questions">
            {mine.map((q) => (
              <QuestionItem key={q.questionId} sessionId={sessionId} question={q} onCancel={cancel} onFollowUp={followUp} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
