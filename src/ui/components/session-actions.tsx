// Session actions (FR-032, FR-033, R16): Close and Delete in a disclosure menu. Delete asks in a native dialog
// that states what is lost, with Cancel focused; Escape or Cancel deletes nothing and returns focus to the menu
// button. A confirmed delete clears this session's view state.

import { useRef, useState } from 'preact/hooks';
import { closeSession, deleteSession } from '../api.ts';
import { clearSession } from '../state/view-state.ts';
import { DisclosureMenu } from './disclosure-menu.tsx';

export function SessionActions(props: { sessionId: string }) {
  const { sessionId } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      location.hash = '#/';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed.');
      dialog.current?.close();
    } finally {
      setBusy(false);
    }
  };
  const returnFocus = (): void => document.getElementById('session-actions-button')?.focus();

  return (
    <div class="session-actions">
      <DisclosureMenu id="session-actions" label="Session actions">
        <button type="button" data-testid="close-session-button" disabled={busy} onClick={() => void run(() => closeSession(sessionId))}>
          Close session
        </button>
        <button
          type="button"
          data-testid="delete-session-button"
          disabled={busy}
          onClick={() =>
            setTimeout(() => {
              dialog.current?.showModal();
              document.getElementById('delete-session-cancel')?.focus();
            }, 0)
          }
        >
          Delete session
        </button>
      </DisclosureMenu>
      <dialog ref={dialog} data-testid="delete-session-dialog" aria-labelledby="delete-session-title" onClose={returnFocus}>
        <h2 id="delete-session-title">Delete this session?</h2>
        <p>This permanently deletes the questions, answers, summaries and snapshots of this session. The pull request itself is not changed.</p>
        <div class="dialog-actions">
          <button type="button" id="delete-session-cancel" data-testid="delete-session-cancel" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            class="button danger"
            data-testid="delete-session-confirm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await deleteSession(sessionId);
                clearSession(sessionId);
              })
            }
          >
            Delete
          </button>
        </div>
      </dialog>
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
