// Fake AI CLI helper (T081), and the US2 end-to-end harness built on it (see the second section). Puts test/fixtures/fake-claude/fake-claude.mjs first on PATH under
// the real CLI's name, selects its scenario through `fake-cli.json`, and reads the invocations it
// recorded. `node --test` runs each file in its own process, so changing `process.env.PATH` here is
// safe across files; the helper restores it when the test ends.

import { execFile } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { CredentialInput } from '../../src/credentials.ts';
import { registerSecret } from '../../src/log.ts';
import type { ReviewStore } from '../../src/store/review-store.ts';
import { useTempAppData, type TempAppData } from './app-data.ts';
import { createFakeKeyring } from './fake-keyring.ts';
import { createGitSandbox, type FileChanges, type GitSandbox } from './git-sandbox.ts';
import { loadFixtures, recordedFetch, type FixtureEntry, type RecordedFetch } from './recorded-fetch.ts';
import { startTestServer, type TestClient } from './server.ts';

const run = promisify(execFile);

export const CLI_NAME = 'claude';
const FAKE_SCRIPT = fileURLToPath(new URL('../fixtures/fake-claude/fake-claude.mjs', import.meta.url));

export type FakeScenario = 'structured' | 'unstructured' | 'slow' | 'error-on-start' | 'not-signed-in';
export type FakeHelp = 'full' | 'no-restricted' | 'no-strict-mcp' | 'no-add-dir';

export type FakeConfig = {
  scenario?: FakeScenario;
  help?: FakeHelp;
  /** Structured output for an answer run. */
  answer?: unknown;
  /** Structured output for a summary run. */
  summary?: unknown;
  /** Raw text for the unstructured scenario. */
  text?: string;
  /** Text deltas per run (default 3). */
  chunks?: number;
  /** Pause between deltas, in milliseconds. */
  delayMs?: number;
};

export type Invocation = {
  /** 1-based order of the run. */
  n: number;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  cwdEntries: string[] | null;
  stdin: string;
};

export interface FakeAiCli {
  readonly binDir: string;
  /** Replaces the fake's configuration; read again by every later run. */
  configure(config: FakeConfig): Promise<void>;
  /** Every `-p` run so far, in order. */
  invocations(): Promise<Invocation[]>;
  /** Lets a held run in the `slow` scenario continue: run `n`, or every run. */
  release(n?: number): Promise<void>;
  /** Waits until at least `count` runs have been recorded. */
  waitForInvocations(count: number, timeoutMs?: number): Promise<Invocation[]>;
}

interface AfterHook {
  after(fn: () => unknown): void;
}

/** Whether a run produced an answer or a summary, read from its `--json-schema` argument. */
export function invocationKind(invocation: Invocation): 'answer' | 'summary' {
  const at = invocation.argv.indexOf('--json-schema');
  return at !== -1 && (invocation.argv[at + 1] ?? '').includes('prSummary') ? 'summary' : 'answer';
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH without any directory holding a CLI of that name, so the real CLI is never found. */
async function pathWithoutCli(path: string): Promise<string[]> {
  const kept: string[] = [];
  for (const dir of path.split(delimiter)) {
    if (dir !== '' && !(await isExecutable(join(dir, CLI_NAME)))) kept.push(dir);
  }
  return kept;
}

/** Restores PATH when the test ends. */
function keepPath(t: AfterHook): void {
  const previous = process.env['PATH'];
  t.after(() => {
    process.env['PATH'] = previous;
  });
}

/**
 * Installs the fake CLI first on PATH for the current test, with `config`.
 * Every directory that holds the real CLI is taken off PATH for the test.
 */
export async function useFakeAiCli(t: AfterHook, config: FakeConfig = {}): Promise<FakeAiCli> {
  if (process.platform === 'win32') throw new Error('the fake AI CLI launcher is POSIX only');
  const binDir = await mkdtemp(join(tmpdir(), 'prwb-fake-cli-'));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const launcher = join(binDir, CLI_NAME);
  await writeFile(launcher, `#!${process.execPath}\nawait import(${JSON.stringify(pathToFileURL(FAKE_SCRIPT).href)});\n`);
  await chmod(launcher, 0o755);
  const configFile = join(binDir, 'fake-cli.json');
  const recordFile = join(binDir, 'invocations.jsonl');

  keepPath(t);
  process.env['PATH'] = [binDir, ...(await pathWithoutCli(process.env['PATH'] ?? ''))].join(delimiter);

  const invocations = async (): Promise<Invocation[]> => {
    const text = await readFile(recordFile, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Invocation);
  };

  const fake: FakeAiCli = {
    binDir,
    configure: (next) => writeFile(configFile, JSON.stringify(next)),
    invocations,
    release: (n) => writeFile(join(binDir, n === undefined ? 'release-all' : `release-${n}`), ''),
    async waitForInvocations(count, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = await invocations();
        if (found.length >= count) return found;
        if (Date.now() > deadline) throw new Error(`expected ${count} fake CLI runs, saw ${found.length}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
  await fake.configure(config);
  return fake;
}

/** Takes every directory holding the CLI off PATH for the current test: the CLI is not installed. */
export async function useNoAiCli(t: AfterHook): Promise<void> {
  keepPath(t);
  const dirs = await pathWithoutCli(process.env['PATH'] ?? '');
  // An empty directory first keeps PATH non-empty even if every entry was dropped.
  const empty = await mkdtemp(join(tmpdir(), 'prwb-no-cli-'));
  await mkdir(empty, { recursive: true });
  t.after(() => rm(empty, { recursive: true, force: true }));
  process.env['PATH'] = [empty, ...dirs].join(delimiter);
}

// ---------------------------------------------------------------------------------------------
// Workbench with the fake CLI (US2 end-to-end harness).
//
// The real server (test/helpers/server.ts) with the context routes and the interrogation routes
// wired as src/main.ts wires them: one review store, one event hub, one set of work lanes, the
// provider from the AI registry, and `onSnapshot`/`onClose` pointed at the summaries and the lanes.
// The platforms are the recorded development source-control platform and project-key tracker. The
// reviewer's clone is a git sandbox whose PR 1 carries `prFiles`; PR 1's recorded head commit is
// replaced, as responses are served, by the sandbox's current head, so pushing a commit moves the
// head the platform reports.


export const PULLS_URL = 'https://api.github.com/repos/acme/widgets/pulls';
export const ISSUE_URL = 'https://acme.atlassian.net/rest/api/3/issue/ABC-12?fields=summary,description';
const FIXTURE_HEAD_1 = 'a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1';
const JIRA_SITE = 'https://acme.atlassian.net';

/** PR 1's default change: lines 40 to 60 of src/app.js, and src/util.js losing `sub` (lines 5 to 7 at base). */
export function defaultPrFiles(): FileChanges {
  const lines = Array.from({ length: 80 }, (_, i) =>
    i + 1 >= 40 && i + 1 <= 60 ? `export const value${i + 1} = ${(i + 1) * 10}; // reset ${i + 1}` : `export const value${i + 1} = ${i + 1};`,
  );
  return {
    'src/app.js': `${lines.join('\n')}\n`,
    'src/util.js': 'export function add(a, b) {\n  return a + b;\n}\n\nexport const version = 2;\n',
  };
}

export type WorkbenchOptions = {
  /**
   * `missing`: the base folder holds the repository's clone, but its head cannot be fetched, so the
   * session's repository row is missing with a reason and its diff comes from the platform.
   * `none`: the base folder holds no clone at all, so the repository is not found. Default `sandbox`.
   */
  clone?: 'sandbox' | 'missing' | 'none';
  prFiles?: FileChanges;
  /** The fake CLI's configuration; `null` means no CLI is installed, `real` uses the installed CLI. */
  fake?: FakeConfig | null | 'real';
  /** PR 1's state on each platform check, in order (the last repeats). Default always open. */
  prStates?: Array<'open' | 'merged'>;
  /** Drops recorded entries whose URL this returns true for. */
  drop?: (url: string) => boolean;
  extra?: FixtureEntry[];
  /** Put the reviewer's clone on another branch with stash, staged, unstaged and untracked changes. */
  dirty?: boolean;
  /**
   * Further clones under the base folder, by repository id (default none). Each is a repository whose
   * `origin` is the repository's https address; fetching from it fails at once, so a session there
   * has no local head (its diff comes from the platform).
   */
  extraClones?: string[];
  /** Wait for the start-up scan of the base folder to end before returning (default true). */
  awaitDiscovery?: boolean;
  /**
   * Boot through `src/main.ts` instead of wiring the routes here. Needs the fake CLI: a fake browser
   * opener goes in its bin directory and appends each URL it is asked to open to `opened.log` there.
   */
  composed?: boolean;
  /**
   * Live mode (FR-032): the real platform instead of fixtures. No sandbox, fixtures or GitHub/Jira
   * defaults; the given configuration, credentials and clone are used as they are, and every
   * platform request goes through `fetch` (a `loggedFetch` around real fetch).
   */
  live?: LiveWorkbench;
};

export type LiveWorkbench = {
  repository: { platform: string; id: string; baseUrl?: string };
  issueTracker: { platform: string; site?: string; projectKeys?: string[] };
  credentials: Record<string, CredentialInput>;
  /** The reviewer's clone. Its parent folder is the base folder; when it does not exist the base folder is empty. */
  clonePath: string;
  fetch: typeof fetch;
};

export type SessionEvent = { event: string; data: unknown };

export interface Workbench {
  client: TestClient;
  store: ReviewStore;
  appData: TempAppData;
  sandbox: GitSandbox | null;
  fake: FakeAiCli | null;
  recorded: RecordedFetch;
  /** Starts (or opens) the session for a PR (default 1 of acme/widgets) and returns its SessionDetail. */
  startSession(prNumber?: number, repository?: string): Promise<Record<string, any>>;
  /** The base folder discovery scans. */
  baseFolder: string;
  /** Waits until discovery is no longer scanning and returns the workspace. */
  discovered(): Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Pushes a commit to PR 1, so the platform reports a new head. */
  pushHead(files: FileChanges): Promise<string>;
  /** Stops the server and starts a new one on the same store, after start-up recovery. */
  restart(): Promise<void>;
  /** Opens the session's event stream and collects its events. */
  subscribe(sessionId: string): Promise<{ events: SessionEvent[]; close(): void }>;
}

/** Polls `probe` until it returns a value other than undefined, null or false. */
export async function waitFor<T>(probe: () => Promise<T | undefined | null | false> | T | undefined | null | false, what: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== null && value !== false) return value as T;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function parseEvents(res: IncomingMessage, into: SessionEvent[]): void {
  let buffer = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = '';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data.push(line.slice(6));
      }
      if (event !== '') into.push({ event, data: JSON.parse(data.join('\n')) });
    }
  });
}

export async function startWorkbench(t: AfterHook, options: WorkbenchOptions = {}): Promise<Workbench> {
  const { createContextRoutes } = await import('../../src/server/routes/context.ts');
  const { createInterrogationRoutes } = await import('../../src/server/routes/interrogation.ts');
  const { registeredPlatforms } = await import('../../src/adapters/registry.ts');
  const { createAiProvider, registeredAiProviders } = await import('../../src/adapters/ai-registry.ts');
  const { ensureAppData } = await import('../../src/appdata.ts');
  const { loadConfig, saveConfig } = await import('../../src/config.ts');
  const { configPlatforms } = await import('../../src/server/routes/context.ts');
  const { adapterDeps, createSourceControl } = await import('../../src/adapters/registry.ts');
  const { createWorkspace } = await import('../../src/core/workspace.ts');
  const { createCredentials } = await import('../../src/credentials.ts');
  const { createGit } = await import('../../src/repo/git.ts');
  const { createRepositoryManager } = await import('../../src/repo/manager.ts');
  const { openDatabase } = await import('../../src/store/db.ts');
  const { createReviewStore } = await import('../../src/store/review-store.ts');
  const { createEventHub } = await import('../../src/server/events.ts');
  const { createLanes } = await import('../../src/core/lanes.ts');
  const { createInterrogation } = await import('../../src/core/interrogation.ts');
  const { createSummaries } = await import('../../src/core/summaries.ts');
  const { recoverInterruptedWork } = await import('../../src/core/work-recovery.ts');

  const appData = await useTempAppData(t);
  const paths = await ensureAppData({ dir: appData.dir });
  const fake = options.fake === null || options.fake === 'real' ? null : await useFakeAiCli(t, options.fake ?? {});
  if (options.fake === null) await useNoAiCli(t);

  const live = options.live;
  let sandbox: GitSandbox | null = null;
  let clonePath = live?.clonePath ?? join(appData.root, 'no-clone-here');
  // The base folder discovery scans: the sandbox's folder (holding the clone), or an empty one.
  let baseFolder = join(appData.root, 'base');
  await mkdir(baseFolder, { recursive: true });
  if (live !== undefined && existsSync(live.clonePath)) baseFolder = dirname(live.clonePath);
  if (live === undefined && options.clone === 'missing') {
    clonePath = join(baseFolder, 'widgets');
    await mkdir(clonePath, { recursive: true });
    const git = (...args: string[]) => run('git', args, { cwd: clonePath });
    await git('init', '-q');
    await git('remote', 'add', 'origin', 'https://github.com/Acme/Widgets');
    await git('config', `url.file://${join(appData.root, 'nowhere')}.insteadOf`, 'https://github.com/acme/widgets.git');
  }
  if (live === undefined && options.clone !== 'missing' && options.clone !== 'none') {
    const s = await createGitSandbox();
    sandbox = s;
    t.after(() => s.cleanup());
    clonePath = s.clone;
    baseFolder = s.root;
    await s.openPr({ number: 1, branch: 'feature/ABC-12-reset', files: options.prFiles ?? defaultPrFiles() });
    await s.git(s.clone, 'remote', 'set-url', 'origin', 'https://github.com/Acme/Widgets');
    await s.git(s.clone, 'config', `url.${s.platform}.insteadOf`, 'https://github.com/acme/widgets.git');
    if (options.dirty) await s.dirtyClone();
    for (const id of options.extraClones ?? []) {
      const folder = join(s.root, 'more', id.replace('/', '-'));
      await mkdir(folder, { recursive: true });
      await s.git(folder, 'init', '-q');
      await s.git(folder, 'remote', 'add', 'origin', `https://github.com/${id}`);
      await s.git(folder, 'config', `url.file://${join(s.root, 'nowhere')}.insteadOf`, `https://github.com/${id}.git`);
    }
  }

  const entries: FixtureEntry[] = [];
  const pr1 = `${PULLS_URL}/1`;
  for (const e of live === undefined ? [...loadFixtures('github'), ...loadFixtures('jira')] : []) {
    if (options.drop?.(e.request.url)) continue;
    if (options.prStates !== undefined && e.request.url === pr1 && e.request.headers === undefined) {
      const body = (e.response as { body: Record<string, unknown> }).body;
      for (const state of options.prStates) {
        const served = state === 'merged' ? { ...body, state: 'closed', merged: true, merged_at: '2026-11-08T12:00:00Z', closed_at: '2026-11-08T12:00:00Z' } : body;
        entries.push({ request: e.request, response: { status: 200, body: served } });
      }
      continue;
    }
    entries.push({ request: e.request, response: e.response });
  }
  entries.push(...(options.extra ?? []));
  const recorded = recordedFetch([], { entries });
  const fixtureNetwork = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await recorded.fetch(input, init);
    let text = await response.text();
    if (sandbox !== null) text = text.split(FIXTURE_HEAD_1).join(sandbox.pr(1).head);
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const network = live?.fetch ?? fixtureNetwork;

  const keyring = createFakeKeyring();
  const credentials = createCredentials({ keyring, registerSecret });
  if (live === undefined) {
    await credentials.save('github', { secret: 'test-github-token', scheme: 'bearer' });
    await credentials.save('jira-cloud', { account: 'alice@acme.example', secret: 'test-jira-token', scheme: 'basic' });
    await saveConfig(
      appData.dir,
      { workspace: { baseFolder, platform: 'github' }, issueTracker: { platform: 'jira-cloud', site: JIRA_SITE, projectKeys: ['ABC'] } },
      configPlatforms(),
    );
  } else {
    for (const [platform, credential] of Object.entries(live.credentials)) await credentials.save(platform, credential);
    const { platform, baseUrl } = live.repository;
    await saveConfig(appData.dir, { workspace: { baseFolder, platform, ...(baseUrl === undefined ? {} : { baseUrl }) }, issueTracker: live.issueTracker }, configPlatforms());
  }

  const git = createGit({ hooksPath: paths.emptyHooks });
  const manager = createRepositoryManager({ git, workspacesDir: paths.workspaces });
  const platforms = configPlatforms();
  const workspace = createWorkspace({
    manager,
    appDataDir: appData.dir,
    matcherFor: ({ platform, baseUrl }) => {
      const repository = { platform, id: '' };
      const sourceControl = createSourceControl(platform, adapterDeps(platform, network, (request) => request), {
        repository,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      });
      return (remote) => sourceControl.repositoryForRemote(remote);
    },
  });
  const environmentFor = async (repo: { platform: string; id: string }) => {
    const config = await loadConfig(appData.dir, platforms);
    if (config === null) throw new Error('not configured');
    const availability = workspace.availability({ platform: repo.platform, id: repo.id });
    return {
      clonePath: workspace.cloneFor(repo.id),
      limits: config.limits,
      ...(availability.available ? {} : { unavailableReason: availability.reason }),
    };
  };

  let db = openDatabase(paths.db);
  t.after(() => db.close());

  const boot = async () => {
    const store = createReviewStore(db);
    recoverInterruptedWork({ store });
    const events = createEventHub({ heartbeatMs: 0 });
    const lanes = createLanes();
    const provider = createAiProvider('claude-code-cli', { providerHome: paths.providerHome });
    const core = { store, lanes, provider, events, git, workspacePath: manager.workspacePath, environmentFor };
    const interrogation = createInterrogation(core);
    const summaries = createSummaries(core);
    const contextRoutes = createContextRoutes({
      appDataDir: appData.dir,
      workspace,
      store,
      credentials,
      network,
      git,
      events,
      aiProviders: registeredAiProviders(),
      onSnapshot: summaries.onSnapshot,
      onClose: (sessionId: string) => lanes.close(sessionId),
      afterRunning: (sessionId: string) => lanes.settledRunning(sessionId),
    });
    const routes = createInterrogationRoutes({ store, git, provider, interrogation, summaries, environmentFor });
    // As src/main.ts does: discovery starts at boot from the saved config.
    workspace.configure((await loadConfig(appData.dir, platforms))?.workspace ?? null);
    const client = await startTestServer({ routes: [contextRoutes, routes], serverOptions: { events } });
    return { store, client };
  };

  // The composed app owns its store connection; this one is the test's view of the same file.
  const composedBoot = async () => {
    const { startWorkbench: launch } = await import('../../src/main.ts');
    const client = await startTestServer({ start: ({ launchToken }) => launch({ keyring, fetch: network, launchToken }) });
    return { store: createReviewStore(db), client };
  };
  if (options.composed) {
    if (fake === null) throw new Error('composed mode needs the fake CLI');
    const opener = join(fake.binDir, process.platform === 'darwin' ? 'open' : 'xdg-open');
    await writeFile(opener, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(fake.binDir, 'opened.log')}'\n`);
    await chmod(opener, 0o755);
  }

  let current = await (options.composed ? composedBoot() : boot());
  t.after(async () => {
    // Let any held run finish so no child process outlives the test (its bin directory may already be gone).
    await fake?.release().catch(() => undefined);
    await current.client.close();
  });

  const bench: Workbench = {
    client: current.client,
    store: current.store,
    appData,
    sandbox,
    fake,
    recorded,
    baseFolder,
    async discovered() {
      return waitFor(async () => {
        const res = await bench.client.get('/api/workspace');
        const body = res.json as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        return res.status === 200 && body.discovery.state !== 'scanning' ? body : undefined;
      }, 'the scan of the base folder to end');
    },
    async startSession(prNumber = 1, repository = 'acme/widgets') {
      const res = await bench.client.post('/api/sessions', { repository, prNumber });
      if (res.status !== 201 && res.status !== 200) throw new Error(`session start failed: ${res.status} ${res.text}`);
      return res.json as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    async pushHead(files) {
      if (sandbox === null) throw new Error('no sandbox');
      return (await sandbox.pushCommit(1, files)).head;
    },
    async restart() {
      await current.client.close();
      db.close();
      db = openDatabase(paths.db);
      current = await (options.composed ? composedBoot() : boot());
      bench.client = current.client;
      bench.store = current.store;
      if (options.awaitDiscovery !== false) await bench.discovered();
    },
    async subscribe(sessionId) {
      const res = await bench.client.open('GET', `/api/sessions/${sessionId}/events`);
      if (res.statusCode !== 200) throw new Error(`event stream refused: ${res.statusCode}`);
      const events: SessionEvent[] = [];
      parseEvents(res, events);
      return { events, close: () => res.destroy() };
    },
  };
  t.after(() => workspace.cancel());
  if (options.awaitDiscovery !== false) await bench.discovered();
  return bench;
}
