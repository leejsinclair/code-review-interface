// Reads "who am I" on the session's source-control platform for an override that must name the reviewer
// (feature 004, FR-020): one read-only GET through the adapter registry, with the credential the reviewer already
// stored, never cached. The browser never supplies a name. Lives in the server layer because it builds an adapter.

import { adapterDeps, createSourceControl, createSourceControlWriter, writerDeps } from '../adapters/registry.ts';
import type { NetworkFetch } from '../adapters/read-only-http.ts';
import { loadConfig } from '../config.ts';
import type { CurrentUser } from '../contracts/source-control.ts';
import { applyDecision, type PullCache } from '../core/pull-cache.ts';
import { createReviewActions, type ReviewActions } from '../core/review-actions.ts';
import type { CredentialStore } from '../credentials.ts';
import type { ReviewStore } from '../store/review-store.ts';
import { configPlatforms } from './routes/context.ts';

export type ReviewerLookupDeps = {
  appDataDir: string;
  store: ReviewStore;
  credentials: CredentialStore;
  network: NetworkFetch;
};

export function createReviewerLookup(deps: ReviewerLookupDeps): (sessionId: string) => Promise<CurrentUser> {
  return async (sessionId) => {
    const session = deps.store.readSession(sessionId);
    if (session === null) throw new Error('No such session.');
    const platform = session.pr.repo.platform;
    const config = await loadConfig(deps.appDataDir, configPlatforms());
    const repository = { platform, id: session.pr.repo.identifier };
    const sourceControl = createSourceControl(platform, adapterDeps(platform, deps.network, deps.credentials.authorize(platform)), {
      repository,
      ...(config?.workspace.baseUrl === undefined ? {} : { baseUrl: config.workspace.baseUrl }),
    });
    return sourceControl.currentUser();
  };
}

// Review actions (feature 005): one `ReviewActions` per session, built from the read adapter and the writer
// registered for the session's platform. Kept per session so the in-flight lock and the request-id memory
// survive between requests. The writer is built here and handed to nothing else (FR-006, VIII.3). Its
// credential is the write-scope one: a sign-in without write access fails the write with `forbidden`.

export type ReviewActionsLookupDeps = ReviewerLookupDeps & { pullCache?: PullCache };

export function createReviewActionsLookup(deps: ReviewActionsLookupDeps): (sessionId: string) => Promise<ReviewActions> {
  const built = new Map<string, ReviewActions>();
  return async (sessionId) => {
    const existing = built.get(sessionId);
    if (existing !== undefined) return existing;
    const session = deps.store.readSession(sessionId);
    if (session === null) throw new Error('No such session.');
    const platform = session.pr.repo.platform;
    const config = await loadConfig(deps.appDataDir, configPlatforms());
    const repo = { platform, id: session.pr.repo.identifier };
    const settings = { repository: repo, ...(config?.workspace.baseUrl === undefined ? {} : { baseUrl: config.workspace.baseUrl }) };
    const sc = createSourceControl(platform, adapterDeps(platform, deps.network, deps.credentials.authorize(platform)), settings);
    const writer = createSourceControlWriter(
      platform,
      writerDeps(deps.network, (request) => deps.credentials.authorizeForWrite(platform)(request)),
      settings,
    );
    const inner = createReviewActions({ sc, writer, store: deps.store, repo, pr: session.pr.number, sessionId });
    // Keep the cached pull request list true: an approval marks it, a changed or withdrawn decision clears the mark.
    const actions: ReviewActions = {
      ...inner,
      async perform(body) {
        const result = await inner.perform(body);
        applyDecision(deps.pullCache, repo.id, session.pr.number, body.action.kind);
        return result;
      },
    };
    built.set(sessionId, actions);
    return actions;
  };
}
