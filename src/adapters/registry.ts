// Platform registry (research R19, FR-025): the one place that maps a configured platform id to its
// adapter. Core, server and UI code know platforms only by these ids and the descriptors listed here.

import type { IssueTracker } from '../contracts/issue-tracker.ts';
import type { AdapterDeps, AdapterDescriptor, Authorize, PlatformId, SignInCheck } from '../contracts/shared.ts';
import type { RepoRef, SourceControlProvider } from '../contracts/source-control.ts';
import { BITBUCKET_CLOUD_DESCRIPTOR, BITBUCKET_CLOUD_ID, createBitbucketCloudSourceControl } from './bitbucket/source-control.ts';
import { createGithubIssuesTracker, GITHUB_ISSUES_DESCRIPTOR, GITHUB_ISSUES_ID } from './github/issues.ts';
import { createGithubSourceControl, GITHUB_DESCRIPTOR, GITHUB_ID } from './github/source-control.ts';
import { createJiraCloudTracker, JIRA_CLOUD_DESCRIPTOR, JIRA_CLOUD_ID } from './jira/issues.ts';
import { createReadOnlyFetch, type NetworkFetch } from './read-only-http.ts';

/** What a tracker needs from the configuration. */
export type TrackerSettings = { repository: RepoRef; site?: string; projectKeys?: readonly string[] };

type SourceControlEntry = { descriptor: AdapterDescriptor; create(deps: AdapterDeps): SourceControlProvider };
type TrackerEntry = { descriptor: AdapterDescriptor; create(deps: AdapterDeps, settings: TrackerSettings): IssueTracker };

const SOURCE_CONTROL: ReadonlyMap<PlatformId, SourceControlEntry> = new Map([
  [GITHUB_ID, { descriptor: GITHUB_DESCRIPTOR, create: createGithubSourceControl }],
  [BITBUCKET_CLOUD_ID, { descriptor: BITBUCKET_CLOUD_DESCRIPTOR, create: createBitbucketCloudSourceControl }],
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
export function registeredPlatforms(): { sourceControl: PlatformId[]; issueTrackers: PlatformId[] } {
  return { sourceControl: [...SOURCE_CONTROL.keys()], issueTrackers: [...TRACKERS.keys()] };
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

export function createSourceControl(platform: PlatformId, deps: AdapterDeps): SourceControlProvider {
  const entry = SOURCE_CONTROL.get(platform);
  if (entry === undefined) throw new UnknownPlatformError(platform);
  return entry.create(deps);
}

export function createIssueTracker(platform: PlatformId, deps: AdapterDeps, settings: TrackerSettings): IssueTracker {
  const entry = TRACKERS.get(platform);
  if (entry === undefined) throw new UnknownPlatformError(platform);
  return entry.create(deps, settings);
}

/** Runs the platform's read-only sign-in check with the given credential callback. */
export function verifySignIn(platform: PlatformId, deps: AdapterDeps, settings: TrackerSettings): Promise<SignInCheck> {
  if (SOURCE_CONTROL.has(platform)) return createSourceControl(platform, deps).verifySignIn();
  return createIssueTracker(platform, deps, settings).verifySignIn();
}
