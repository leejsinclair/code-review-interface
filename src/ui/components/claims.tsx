// Claims list (FR-016 to FR-019, FR-022, FR-045): each claim with its Evidence or Inference label,
// documented intent grouped apart from inferred intent, and each reference opening the code at its
// commit, the issue, or the PR description. Also the small pieces shown with every answer and
// summary: the warning, the context version and the restrictions not enforced. Every claim and
// reference string is rendered as a text node (R7).

import type { Claim, GenerationWarning, Ref, RestrictionId } from '../../contracts/http.ts';
import { useContext } from 'preact/hooks';
import { CLAIM_LABELS, INTENT_LABELS, INTENT_ORDER } from '../labels.ts';
import { ReviewContext } from '../state/review-context.ts';
import { codeHref } from '../state/routes.ts';
import { Badge } from './badge.tsx';

const sessionHash = (sessionId: string, rest: string): string => `#/sessions/${encodeURIComponent(sessionId)}${rest}`;

/** Where a reference opens (contracts/ui.md routes). */
export function refHref(sessionId: string, snapshotId: string, ref: Ref): string {
  if (ref.kind === 'code') {
    return codeHref(sessionId, { snapshot: snapshotId, side: ref.side, path: ref.path, start: ref.startLine, end: ref.endLine });
  }
  if (ref.kind === 'issue') return sessionHash(sessionId, `/issues/${encodeURIComponent(ref.platform)}/${encodeURIComponent(ref.key)}`);
  return sessionHash(sessionId, '/description');
}

function refText(ref: Ref): string {
  if (ref.kind === 'code') {
    const lines = ref.startLine === ref.endLine ? `${ref.startLine}` : `${ref.startLine}-${ref.endLine}`;
    return `${ref.path}:${lines} (${ref.side})`;
  }
  if (ref.kind === 'issue') return ref.key;
  return 'PR description';
}

function ClaimItem(props: { sessionId: string; snapshotId: string; claim: Claim }) {
  const { claim } = props;
  const ctx = useContext(ReviewContext);
  const downgraded = claim.labelledByProvider !== claim.label;
  return (
    <li data-testid="claim" data-label={claim.label} {...(claim.intent === undefined ? {} : { 'data-intent': claim.intent })} class="claim">
      <Badge kind="claim" label={claim.label} />
      {claim.intent !== undefined && <Badge kind="intent" intent={claim.intent} />}
      {downgraded && <span class="muted">{` (proposed as ${CLAIM_LABELS[claim.labelledByProvider]})`}</span>}{' '}
      <span>{claim.text}</span>
      {claim.refs.length > 0 && (
        <ul class="refs">
          {claim.refs.map((ref, i) => (
            <li key={i}>
              <a
                data-testid="claim-ref"
                data-kind={ref.kind}
                href={refHref(props.sessionId, props.snapshotId, ref)}
                onClick={(e) => {
                  if (ref.kind !== 'code' || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  ctx.openEvidence({ snapshot: props.snapshotId, side: ref.side, path: ref.path, start: ref.startLine, end: ref.endLine }, (e.currentTarget as HTMLElement).id);
                }}
              >
                {refText(ref)}
              </a>
              {!ref.resolved && (
                <>
                  {' '}
                  <Badge kind="unresolved" reason={ref.unresolvedReason ?? 'not checked'} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The claims, with documented and inferred intent each in its own group (FR-017). */
export function ClaimsList(props: { sessionId: string; snapshotId: string; claims: Claim[] }) {
  const { sessionId, snapshotId, claims } = props;
  const plain = claims.filter((c) => c.intent === undefined);
  const item = (claim: Claim, i: number) => <ClaimItem key={i} sessionId={sessionId} snapshotId={snapshotId} claim={claim} />;
  return (
    <div class="claims">
      {plain.length > 0 && <ul class="list">{plain.map(item)}</ul>}
      {INTENT_ORDER.map((intent) => {
        const group = claims.filter((c) => c.intent === intent);
        if (group.length === 0) return null;
        return (
          <section key={intent} data-testid={`intent-${intent}`}>
            <h4>{INTENT_LABELS[intent]}</h4>
            <ul class="list">{group.map(item)}</ul>
          </section>
        );
      })}
    </div>
  );
}

const WARNING_TEXT: Record<GenerationWarning, string> = {
  unstructured: 'The provider did not return labelled claims; its text is shown as one Inference.',
  cancelled: 'Cancelled: the text received so far is shown as one Inference.',
};

export function AnswerWarning(props: { warning?: GenerationWarning | undefined }) {
  if (props.warning === undefined) return null;
  return (
    <p data-testid="answer-warning" data-warning={props.warning} class="warning">
      {WARNING_TEXT[props.warning]}
    </p>
  );
}

export function ContextVersion(props: { value: string }) {
  if (props.value === '') return null;
  return (
    <span data-testid="context-version" class="chip mono" title="Context version">
      {props.value}
    </span>
  );
}

const RESTRICTION_TEXT: Record<RestrictionId, string> = {
  'workspace-read-search-tools-only': '(a) only read and search tools on the isolated workspace',
  'no-reads-outside-workspace': '(b) no reads outside the workspace',
  'no-network-tools': '(c) no network tools',
  'no-repository-configuration': '(d) no repository configuration loaded',
  'untrusted-input-delimited': '(e) PR, issue and code text passed as delimited data',
};

/** Names each FR-022 restriction not enforced; nothing when all are. */
export function RestrictionsNotEnforced(props: { ids: RestrictionId[] }) {
  if (props.ids.length === 0) return null;
  return (
    <div data-testid="restrictions-not-enforced" class="warning">
      <span>Restrictions not enforced: </span>
      <ul class="list">
        {props.ids.map((id) => (
          <li key={id}>{RESTRICTION_TEXT[id]}</li>
        ))}
      </ul>
    </div>
  );
}
