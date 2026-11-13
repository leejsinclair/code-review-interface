// Override a file's risk class (contracts/ui.md "Override dialog"). A native modal dialog: focus moves to the first
// field and back to the button on close, Escape closes it. Lowering a class that was calculated Critical shows who
// will be recorded, read from the platform by the server and never typed here (FR-020). The reason is required and
// at most 2,000 characters. A server refusal is shown inside the dialog, which stays open. Every string is text.

import { useEffect, useState } from 'preact/hooks';
import type { OverrideRecord, RiskClass, RiskFile, RiskReviewer } from '../../contracts/http.ts';
import { getOverrideHistory, getReviewer, postOverride } from '../api.ts';
import { RISK_LABELS } from '../labels.ts';

export const REASON_MAX = 2000;
/** Lowest scrutiny first, the order the select lists them in. */
const ASCENDING: readonly RiskClass[] = ['low', 'normal', 'elevated', 'critical'];

const word = (c: RiskClass): string => RISK_LABELS.class[c];

export function OverrideDialog(props: {
  sessionId: string;
  snapshotId: string;
  file: RiskFile;
  /** Called with the new record once it is stored; the caller reloads the report and announces the change. */
  onSaved: (record: OverrideRecord) => void | Promise<void>;
  /** Called after the dialog closes, for any reason. */
  onClosed: () => void;
  dialogRef: { current: HTMLDialogElement | null };
}) {
  const { sessionId, snapshotId, file, onSaved, onClosed, dialogRef } = props;
  const options = ASCENDING.filter((c) => c !== file.effectiveClass);
  const [cls, setCls] = useState<RiskClass>(options[0] ?? 'low');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewer, setReviewer] = useState<RiskReviewer | 'loading' | null>(null);

  // A Critical class taken below Critical names the reviewer; the test is on the calculated class (FR-020).
  const needsName = file.assessedClass === 'critical' && cls !== 'critical';

  useEffect(() => {
    if (!needsName) {
      setReviewer(null);
      return undefined;
    }
    let live = true;
    setReviewer('loading');
    getReviewer(sessionId)
      .then((r) => live && setReviewer(r))
      .catch((e: unknown) => live && setReviewer({ ok: false, reason: e instanceof Error ? e.message : 'The platform account could not be read.', fix: 'Try again' }));
    return () => {
      live = false;
    };
  }, [needsName, sessionId, file.path, file.effectiveClass]);

  const blockedByName = needsName && (reviewer === 'loading' || reviewer === null || !reviewer.ok);

  const save = async (): Promise<void> => {
    if (reason.trim() === '') {
      setError('The reason is required: say why the class changes.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const record = await postOverride(sessionId, { snapshotId, path: file.path, class: cls, reason });
      await onSaved(record);
      setReason('');
      dialogRef.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The override could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} data-testid="override-dialog" aria-labelledby="override-title" onClose={onClosed}>
      <h2 id="override-title">Override class</h2>
      <p class="muted">
        {word(file.effectiveClass)} now. The change is recorded with its reason; it never deletes the calculated class or the reasons.
      </p>
      <div class="stack">
        <label>
          Class
          <select data-testid="override-class-select" id="override-class-select" value={cls} onChange={(e) => setCls((e.currentTarget as HTMLSelectElement).value as RiskClass)}>
            {options.map((c) => (
              <option key={c} value={c}>
                {word(c)}
              </option>
            ))}
          </select>
        </label>
        {needsName && reviewer !== null && (
          <>
            {reviewer === 'loading' && <p class="muted">Reading your platform account…</p>}
            {reviewer !== 'loading' && reviewer.ok && (
              <p data-testid="override-reviewer">{`Recorded as: ${reviewer.displayName} (${reviewer.handle})`}</p>
            )}
            {reviewer !== 'loading' && !reviewer.ok && (
              <p data-testid="override-reviewer-problem" role="alert">
                {`${reviewer.reason} ${reviewer.fix}. Lowering this file's class names you, so it cannot be saved now. Other overrides remain possible.`}
              </p>
            )}
          </>
        )}
        <label>
          Reason
          <textarea
            data-testid="override-reason"
            required
            rows={4}
            maxLength={REASON_MAX}
            value={reason}
            onInput={(e) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
          />
        </label>
        <p class="muted" data-testid="override-reason-count">{`${reason.length} / 2,000`}</p>
        {error !== null && (
          <p class="error" role="alert" data-testid="override-error">
            {error}
          </p>
        )}
      </div>
      <div class="dialog-actions">
        <button type="button" data-testid="override-cancel" onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <button type="button" class="button" data-testid="override-save" disabled={busy || blockedByName} onClick={() => void save()}>
          Save override
        </button>
      </div>
    </dialog>
  );
}

const when = (iso: string): string => iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');

/** What the override did to this file, as text: in force, or lapsed with its recorded reason. */
export function OverrideState(props: { file: RiskFile }) {
  const { file } = props;
  const o = file.override;
  if (o === undefined) return null;
  const by = o.record.reviewer === undefined ? '' : ` Recorded by ${o.record.reviewer.displayName} (${o.record.reviewer.handle}).`;
  return (
    <p data-testid="override-state" data-applies={o.applies ? 'true' : 'false'}>
      {o.applies
        ? `${RISK_LABELS.origin.override}: ${word(o.record.class)} (was ${word(file.assessedClass)}). Reason: ${o.record.reason}${by}`
        : `Override lapsed: this file's change differs. Recorded reason: ${o.record.reason}.`}
    </p>
  );
}

/** The file's override records, oldest first, behind a disclosure (US5-AS4). Never a total, ranking or per-person view. */
export function OverrideHistory(props: { sessionId: string; path: string; version: number }) {
  const { sessionId, path, version } = props;
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<OverrideRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    getOverrideHistory(sessionId, path)
      .then((h) => live && (setRecords(h.records), setError(null)))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the history.'));
    return () => {
      live = false;
    };
  }, [open, sessionId, path, version]);
  return (
    <div class="override-history">
      <button type="button" class="link-button" data-testid="override-history-toggle" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen(!open)}>
        History
      </button>
      {open && error !== null && <p class="error">{error}</p>}
      {open && records !== null && (
        <ol data-testid="override-history">
          {records.map((r) => (
            <li key={r.id}>
              {`${when(r.createdAt)} · ${word(r.class)} (was ${word(r.replacedClass)}) · ${r.reason}${r.reviewer === undefined ? '' : ` · ${r.reviewer.displayName} (${r.reviewer.handle})`}`}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
