// Platform registry (research R19, FR-025): the one place that maps a configured platform id to its
// adapter. Core, server and UI code know platforms only by these ids and the descriptors listed here.

import type { IssueTracker } from '../contracts/issue-tracker.ts';
import type { AdapterDeps, AdapterDescriptor, Authorize, PlatformId, SignInCheck } from '../contracts/shared.ts';
import type { RepoRef, SourceControlProvider } from '../contracts/source-control.ts';
import type { SourceControlWriter } from '../contracts/source-control-writer.ts';
import { createBitbucketCloudSourceControlWriter } from './bitbucket/source-control-writer.ts';
import { BITBUCKET_CLOUD_DESCRIPTOR, BITBUCKET_CLOUD_ID, createBitbucketCloudSourceControl } from './bitbucket/source-control.ts';
import { createGithubIssuesTracker, GITHUB_ISSUES_DESCRIPTOR, GITHUB_ISSUES_ID } from './github/issues.ts';
import { createGithubSourceControlWriter } from './github/source-control-writer.ts';
import { createGithubSourceControl, GITHUB_DESCRIPTOR, GITHUB_ID } from './github/source-control.ts';
import { createGitlabIssuesTracker, GITLAB_ISSUES_DESCRIPTOR, GITLAB_ISSUES_ID } from './gitlab/issues.ts';
import { createGitlabSourceControlWriter } from './gitlab/source-control-writer.ts';
import { createGitlabSourceControl, GITLAB_DESCRIPTOR, GITLAB_ID } from './gitlab/source-control.ts';
import { createJiraCloudTracker, JIRA_CLOUD_DESCRIPTOR, JIRA_CLOUD_ID } from './jira/issues.ts';
import { createReadOnlyFetch, type NetworkFetch } from './read-only-http.ts';

/** What a tracker needs from the configuration. */
export type TrackerSettings = { repository: RepoRef; site?: string; projectKeys?: readonly string[] };

/** What a source-control adapter needs from the configuration (R1). Platforms that are not self-hosted ignore it. */
export type SourceControlSettings = { repository: RepoRef; baseUrl?: string };

type SourceControlEntry = { descriptor: AdapterDescriptor; create(deps: AdapterDeps, settings: SourceControlSettings): SourceControlProvider };
type TrackerEntry = { descriptor: AdapterDescriptor; create(deps: AdapterDeps, settings: TrackerSettings): IssueTracker };

const SOURCE_CONTROL: ReadonlyMap<PlatformId, SourceControlEntry> = new Map<PlatformId, SourceControlEntry>([
  [GITHUB_ID, { descriptor: GITHUB_DESCRIPTOR, create: (deps) => createGithubSourceControl(deps) }],
  [BITBUCKET_CLOUD_ID, { descriptor: BITBUCKET_CLOUD_DESCRIPTOR, create: (deps) => createBitbucketCloudSourceControl(deps) }],
  [GITLAB_ID, { descriptor: GITLAB_DESCRIPTOR, create: (deps, settings) => createGitlabSourceControl(deps, settings) }],
]);

/** What a writer gets: the raw network fetch, because each writer builds its own allowlisted write layer (VIII.3). */
export type WriterDeps = { fetch: NetworkFetch; authorize: Authorize };

/** Separate from the read map: a platform's writer is reachable only through here (constitution VIII.3). */
const SOURCE_WRITER: ReadonlyMap<PlatformId, (deps: WriterDeps, settings: SourceControlSettings) => SourceControlWriter> = new Map([
  [GITHUB_ID, (deps: WriterDeps) => createGithubSourceControlWriter(deps)],
  [BITBUCKET_CLOUD_ID, (deps: WriterDeps) => createBitbucketCloudSourceControlWriter(deps)],
  [GITLAB_ID, (deps: WriterDeps, settings: SourceControlSettings) => createGitlabSourceControlWriter(deps, settings)],
]);

const TRACKERS: ReadonlyMap<PlatformId, TrackerEntry> = new Map<PlatformId, TrackerEntry>([
  [
    GITHUB_ISSUES_ID,
    { descriptor: GITHUB_ISSUES_DESCRIPTOR, create: (deps, settings) => createGithubIssuesTracker(deps, { repository: settings.repository.id }) },
  ],
  [
    JIRA_CLOUD_ID,
    {
      descriptor: JIRA_CLOUD_DESCRIPTOR,
      create: (deps, settings) => createJiraCloudTracker(deps, { site: settings.site ?? '', projectKeys: settings.projectKeys ?? [] }),
    },
  ],
  [
    GITLAB_ISSUES_ID,
    {
      descriptor: GITLAB_ISSUES_DESCRIPTOR,
      create: (deps, settings) => createGitlabIssuesTracker(deps, { site: settings.site ?? '', repository: settings.repository.id }),
    },
  ],
]);

export class UnknownPlatformError extends Error {
  readonly platform: string;
  constructor(platform: string) {
    super(`no adapter is registered for platform "${platform}"`);
    this.name = 'UnknownPlatformError';
    this.platform = platform;
  }
}

/** The registered ids by role, for configuration validation and `/api/platforms`. */
export function registeredPlatforms(): { sourceControl: PlatformId[]; issueTrackers: PlatformId[]; needsBaseUrl: PlatformId[] } {
  const needsBaseUrl = [...SOURCE_CONTROL.values()].filter((e) => e.descriptor.needsBaseUrl === true).map((e) => e.descriptor.id);
  return { sourceControl: [...SOURCE_CONTROL.keys()], issueTrackers: [...TRACKERS.keys()], needsBaseUrl };
}

/** Display name and sign-in fields of every registered platform. */
export function platformDescriptors(): AdapterDescriptor[] {
  return [...SOURCE_CONTROL.values(), ...TRACKERS.values()].map((entry) => entry.descriptor);
}

export function descriptorOf(platform: PlatformId): AdapterDescriptor | undefined {
  return (SOURCE_CONTROL.get(platform) ?? TRACKERS.get(platform))?.descriptor;
}

/** The read-only fetch for the platform plus its credential callback. */
export function adapterDeps(platform: PlatformId, network: NetworkFetch, authorize: Authorize): AdapterDeps {
  return { fetch: createReadOnlyFetch({ platform, fetch: network }), authorize };
}

export function createSourceControl(platform: PlatformId, deps: AdapterDeps, settings: SourceControlSettings): SourceControlProvider {
  const entry = SOURCE_CONTROL.get(platform);
  if (entry === undefined) throw new UnknownPlatformError(platform);
  return entry.create(deps, settings);
}

/** Writer deps, kept apart from `adapterDeps`: no read-only wrapper, the writer applies its own allowlist. */
export function writerDeps(network: NetworkFetch, authorize: Authorize): WriterDeps {
  return { fetch: network, authorize };
}

export function createSourceControlWriter(platform: PlatformId, deps: WriterDeps, settings: SourceControlSettings): SourceControlWriter {
  const create = SOURCE_WRITER.get(platform);
  if (create === undefined) throw new UnknownPlatformError(platform);
  return create(deps, settings);
}

export function createIssueTracker(platform: PlatformId, deps: AdapterDeps, settings: TrackerSettings): IssueTracker {
  const entry = TRACKERS.get(platform);
  if (entry === undefined) throw new UnknownPlatformError(platform);
  return entry.create(deps, settings);
}

/** Runs the platform's read-only sign-in check with the given credential callback. */
export function verifySignIn(platform: PlatformId, deps: AdapterDeps, settings: SourceControlSettings & TrackerSettings): Promise<SignInCheck> {
  if (SOURCE_CONTROL.has(platform)) return createSourceControl(platform, deps, settings).verifySignIn();
  return createIssueTracker(platform, deps, settings).verifySignIn();
}
