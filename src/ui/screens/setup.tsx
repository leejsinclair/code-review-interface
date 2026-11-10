// Set-up screen (`#/setup`, FR-034 to FR-037, FR-048, FR-056): a base folder and the platform whose repositories
// live under it, the tracker fields the chosen tracker declares, limits in human units, the discovery result and a
// connection checklist after saving. The server validates; refusals name a field path and are shown at that field
// and in a summary. No platform is named here: lists and fields come from `/api/platforms`.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ConfigBody, Platforms, ProviderStatus, SignIn, Workspace } from '../../contracts/http.ts';
import { ApiError, cancelDiscovery, getConfig, getPlatforms, getProvider, getWorkspace, listSignIns, rescanWorkspace, saveConfig } from '../api.ts';
import { AsyncRegion } from '../components/async-region.tsx';
import { formatBytes, formatLines, parseKilobytes } from '../state/units.ts';

type Form = {
  baseFolder: string;
  platform: string;
  baseUrl: string;
  trackerPlatform: string;
  site: string;
  projectKeys: string;
  maxFileKb: string;
  maxChangedLines: string;
  maxPromptChars: string;
};

const EMPTY: Form = {
  baseFolder: '',
  platform: '',
  baseUrl: '',
  trackerPlatform: '',
  site: '',
  projectKeys: '',
  maxFileKb: formatBytes(1_048_576).replace(' KB', ''),
  maxChangedLines: '5000',
  maxPromptChars: '400000',
};

/** The form field each server field path belongs to, and its test id. */
const FIELDS: Record<string, { key: keyof Form; testid: string; label: string }> = {
  'workspace.baseFolder': { key: 'baseFolder', testid: 'setup-base-folder', label: 'Base folder' },
  'workspace.platform': { key: 'platform', testid: 'setup-platform', label: 'Platform' },
  'workspace.baseUrl': { key: 'baseUrl', testid: 'setup-base-url', label: 'Base address' },
  'issueTracker.platform': { key: 'trackerPlatform', testid: 'setup-tracker', label: 'Issue tracker' },
  'issueTracker.site': { key: 'site', testid: 'setup-site', label: 'Tracker site' },
  'issueTracker.projectKeys': { key: 'projectKeys', testid: 'setup-project-keys', label: 'Project keys' },
  'limits.maxFileBytes': { key: 'maxFileKb', testid: 'setup-max-file-kb', label: 'Largest file in a prompt' },
  'limits.maxChangedLines': { key: 'maxChangedLines', testid: 'setup-max-changed-lines', label: 'Most changed lines per file' },
  'limits.maxPromptChars': { key: 'maxPromptChars', testid: 'setup-max-prompt-chars', label: 'Prompt budget' },
};

const fieldOf = (message: string): string | undefined => Object.keys(FIELDS).find((path) => message.includes(path));

function toBody(form: Form, needsBaseUrl: boolean, declared: readonly string[]): ConfigBody | string {
  const keys = form.projectKeys.split(/[\s,]+/).filter((k) => k !== '');
  const issueTracker: ConfigBody['issueTracker'] = { platform: form.trackerPlatform };
  if (declared.includes('site') && form.site.trim() !== '') issueTracker.site = form.site.trim();
  if (declared.includes('projectKeys') && keys.length > 0) issueTracker.projectKeys = keys;
  const workspace: ConfigBody['workspace'] = { baseFolder: form.baseFolder.trim(), platform: form.platform };
  if (needsBaseUrl && form.baseUrl.trim() !== '') workspace.baseUrl = form.baseUrl.trim();
  const bytes = parseKilobytes(form.maxFileKb);
  if (bytes === null) return 'limits.maxFileBytes: enter a whole number of KB, 1 or more.';
  return { workspace, issueTracker, limits: { maxFileBytes: bytes, maxChangedLines: Number(form.maxChangedLines), maxPromptChars: Number(form.maxPromptChars) } };
}

type Check = { id: string; testid: string; status: 'ok' | 'failed' | 'not-checked'; detail: string; nextStep?: string; waitsFor?: string };

function buildChecks(workspace: Workspace | null, signins: SignIn[] | null, provider: ProviderStatus | null, platforms: Platforms | null): Check[] {
  const name = (id: string): string => platforms?.descriptors.find((d) => d.id === id)?.displayName ?? id;
  const checks: Check[] = [];
  if (workspace === null) {
    checks.push({ id: 'base-folder', testid: 'check-base-folder', status: 'not-checked', detail: 'Base folder', waitsFor: 'the workspace to load' });
    checks.push({ id: 'repositories', testid: 'check-repositories', status: 'not-checked', detail: 'Repositories', waitsFor: 'the workspace to load' });
  } else {
    const scanning = workspace.discovery.state === 'scanning' || workspace.discovery.state === 'idle';
    checks.push({ id: 'base-folder', testid: 'check-base-folder', status: workspace.discovery.state === 'failed' ? 'failed' : 'ok', detail: workspace.baseFolder, ...(workspace.discovery.state === 'failed' ? { nextStep: workspace.discovery.reason ?? 'Check the base folder.' } : {}) });
    checks.push(
      scanning
        ? { id: 'repositories', testid: 'check-repositories', status: 'not-checked', detail: 'Repositories', waitsFor: 'the scan to finish' }
        : workspace.matched.length === 0
          ? { id: 'repositories', testid: 'check-repositories', status: 'failed', detail: `No repositories found, ${workspace.skipped.length} skipped`, nextStep: 'Check the base folder and the platform.' }
          : { id: 'repositories', testid: 'check-repositories', status: 'ok', detail: `${workspace.matched.length} repositories found, ${workspace.skipped.length} skipped` },
    );
  }
  for (const platform of new Set([workspace?.platform, ...(signins ?? []).map((s) => s.platform)].filter((p): p is string => p !== undefined))) {
    const s = signins?.find((x) => x.platform === platform);
    checks.push(
      signins === null
        ? { id: `signin:${platform}`, testid: `check-signin-${platform}`, status: 'not-checked', detail: name(platform), waitsFor: 'the sign-ins to load' }
        : s?.state === 'signed-in'
          ? { id: `signin:${platform}`, testid: `check-signin-${platform}`, status: 'ok', detail: `Signed in to ${name(platform)}` }
          : { id: `signin:${platform}`, testid: `check-signin-${platform}`, status: 'failed', detail: `Not signed in to ${name(platform)}`, nextStep: `Sign in to ${name(platform)}` },
    );
  }
  checks.push(
    provider === null
      ? { id: 'ai-provider', testid: 'check-provider', status: 'not-checked', detail: 'AI provider', waitsFor: 'the provider check to answer' }
      : provider.available
        ? { id: 'ai-provider', testid: 'check-provider', status: 'ok', detail: 'AI provider available' }
        : { id: 'ai-provider', testid: 'check-provider', status: 'failed', detail: 'AI provider unavailable', nextStep: provider.unavailableReason ?? 'Install and sign in to the provider.' },
  );
  return checks;
}

const GLYPH = { ok: '✓', failed: '✕', 'not-checked': '?' } as const;

export function SetupScreen() {
  const [platforms, setPlatforms] = useState<Platforms | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<{ path: string | undefined; message: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [signins, setSignins] = useState<SignIn[] | null>(null);
  const [signinsError, setSigninsError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getPlatforms()
      .then(setPlatforms)
      .catch((e: unknown) => setErrors([{ path: undefined, message: e instanceof Error ? e.message : 'Could not load platforms.' }]));
    getConfig()
      .then((config) => {
        if (config === null) return;
        setSaved(true);
        setForm({
          baseFolder: config.workspace.baseFolder,
          platform: config.workspace.platform,
          baseUrl: config.workspace.baseUrl ?? '',
          trackerPlatform: config.issueTracker.platform,
          site: config.issueTracker.site ?? '',
          projectKeys: (config.issueTracker.projectKeys ?? []).join(', '),
          maxFileKb: formatBytes(config.limits.maxFileBytes).replace(' KB', ''),
          maxChangedLines: String(config.limits.maxChangedLines),
          maxPromptChars: String(config.limits.maxPromptChars),
        });
      })
      .catch(() => undefined);
  }, []);

  // The discovery result and the checklist, once a configuration exists; polled while a scan runs.
  useEffect(() => {
    if (!saved) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = (): void => {
      getWorkspace()
        .then((w) => {
          if (!live) return;
          setWorkspace(w);
          setWorkspaceError(null);
          if (w.discovery.state === 'scanning' || w.discovery.state === 'idle') timer = setTimeout(poll, 1000);
        })
        .catch((e: unknown) => live && setWorkspaceError(e instanceof Error ? e.message : 'Could not read the discovery result.'));
    };
    poll();
    listSignIns()
      .then((s) => live && (setSignins(s), setSigninsError(null)))
      .catch((e: unknown) => live && setSigninsError(e instanceof Error ? e.message : 'Could not read the sign-ins.'));
    getProvider()
      .then((p) => live && setProvider(p))
      .catch(() => undefined);
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [saved, attempt]);

  const name = (id: string): string => platforms?.descriptors.find((d) => d.id === id)?.displayName ?? id;
  const sc = platforms?.descriptors.find((d) => d.id === form.platform);
  const tracker = platforms?.descriptors.find((d) => d.id === form.trackerPlatform);
  const needsBaseUrl = sc?.needsBaseUrl === true;
  const declared = tracker?.settingsFields ?? [];
  const errorAt = (key: keyof Form) => {
    const path = Object.keys(FIELDS).find((p) => FIELDS[p]!.key === key);
    return errors.find((e) => e.path === path);
  };
  const input = (key: keyof Form, testid: string) => {
    const err = errorAt(key);
    return {
      'data-testid': testid,
      value: form[key],
      onInput: (event: Event) => setForm({ ...form, [key]: (event.currentTarget as HTMLInputElement).value }),
      ...(err === undefined ? {} : { 'aria-invalid': 'true' as const, 'aria-describedby': `${testid}-error` }),
    };
  };
  const fieldError = (key: keyof Form, testid: string) => {
    const err = errorAt(key);
    return err === undefined ? null : (
      <span class="error" id={`${testid}-error`} data-testid={`${testid}-error`}>
        {err.message}
      </span>
    );
  };

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setErrors([]);
    const body = toBody(form, needsBaseUrl, declared);
    try {
      if (typeof body === 'string') throw new ApiError(400, 'invalid_request', body);
      await saveConfig(body);
      setSaved(true);
      setWorkspace(null);
      setAttempt((n) => n + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The configuration could not be saved.';
      setErrors([{ path: fieldOf(message), message }]);
      queueMicrotask(() => summary.current?.focus());
    } finally {
      setSaving(false);
    }
  };

  const rescan = (): void => {
    setWorkspace(null);
    rescanWorkspace()
      .then(() => setAttempt((n) => n + 1))
      .catch((e: unknown) => setWorkspaceError(e instanceof Error ? e.message : 'Could not start a rescan.'));
  };
  const cancel = (): void => {
    cancelDiscovery()
      .then(setWorkspace)
      .catch(() => undefined);
  };

  const checks = buildChecks(workspace, signins, provider, platforms);
  const scanning = workspace?.discovery.state === 'scanning' || workspace?.discovery.state === 'idle';

  return (
    <section class="panel stack" data-testid="setup">
      <h1 class="page-header">Setup</h1>
      <form class="stack" onSubmit={submit} noValidate>
        {errors.length > 0 && (
          <div ref={summary} tabIndex={-1} class="error" role="alert" data-testid="setup-error">
            {errors.map((e, i) => {
              const f = e.path === undefined ? undefined : FIELDS[e.path];
              return (
                <p key={i}>
                  {f !== undefined ? <a href={`#`} onClick={(ev) => { ev.preventDefault(); document.querySelector<HTMLElement>(`[data-testid="${f.testid}"]`)?.focus(); }}>{f.label}</a> : null}
                  {f !== undefined ? ': ' : ''}
                  {e.message}
                </p>
              );
            })}
          </div>
        )}
        <label>
          Base folder
          <input type="text" {...input('baseFolder', 'setup-base-folder')} required />
          {fieldError('baseFolder', 'setup-base-folder')}
        </label>
        <label>
          Platform
          <select {...input('platform', 'setup-platform')} required>
            <option value="">Choose…</option>
            {(platforms?.sourceControl ?? []).map((id) => (
              <option key={id} value={id}>
                {name(id)}
              </option>
            ))}
          </select>
          {fieldError('platform', 'setup-platform')}
        </label>
        {needsBaseUrl && (
          <label>
            Base address (the self-hosted instance, e.g. https://git.example.com)
            <input type="url" {...input('baseUrl', 'setup-base-url')} required />
            {fieldError('baseUrl', 'setup-base-url')}
          </label>
        )}
        <label>
          Issue tracker
          <select {...input('trackerPlatform', 'setup-tracker')} required>
            <option value="">Choose…</option>
            {(platforms?.issueTrackers ?? []).map((id) => (
              <option key={id} value={id}>
                {name(id)}
              </option>
            ))}
          </select>
          {fieldError('trackerPlatform', 'setup-tracker')}
        </label>
        {declared.includes('site') && (
          <label>
            Tracker site
            <input type="url" {...input('site', 'setup-site')} />
            {fieldError('site', 'setup-site')}
          </label>
        )}
        {declared.includes('projectKeys') && (
          <label>
            Project keys (comma separated)
            <input type="text" {...input('projectKeys', 'setup-project-keys')} />
            {fieldError('projectKeys', 'setup-project-keys')}
          </label>
        )}
        <details data-testid="advanced-limits">
          <summary>Advanced limits</summary>
          <div class="stack">
            <label>
              Largest file in a prompt (KB, default {formatBytes(1_048_576)})
              <input type="text" inputMode="numeric" {...input('maxFileKb', 'setup-max-file-kb')} />
              {fieldError('maxFileKb', 'setup-max-file-kb')}
            </label>
            <label>
              Most changed lines per file (default {formatLines(5000)})
              <input type="number" min="1" {...input('maxChangedLines', 'setup-max-changed-lines')} />
              {fieldError('maxChangedLines', 'setup-max-changed-lines')}
            </label>
            <label>
              Prompt budget (characters, default {formatLines(400000)})
              <input type="number" min="1" {...input('maxPromptChars', 'setup-max-prompt-chars')} />
              {fieldError('maxPromptChars', 'setup-max-prompt-chars')}
            </label>
          </div>
        </details>
        <button class="button" type="submit" aria-disabled={saving ? 'true' : undefined}>
          Save
        </button>
      </form>
      {saved && (
        <>
          <AsyncRegion
            region="workspace"
            label="the discovery result"
            {...(workspaceError !== null ? ({ state: 'failed', reason: workspaceError, retry: () => setAttempt((n) => n + 1) } as const) : workspace === null ? ({ state: 'loading' } as const) : ({ state: 'loaded' } as const))}
          >
            {workspace !== null && (
              <section data-testid="discovery-result" data-state={workspace.discovery.state}>
                <h2>Repositories found</h2>
                {scanning ? (
                  <p>
                    <span data-testid="discovery-progress" role="status">{`Scanning… ${workspace.discovery.foldersScanned} folders scanned`}</span>{' '}
                    <button type="button" data-testid="discovery-cancel" onClick={cancel}>
                      Cancel
                    </button>
                  </p>
                ) : (
                  <p>
                    {workspace.discovery.state === 'failed'
                      ? `The scan failed: ${workspace.discovery.reason ?? 'unknown reason'}.`
                      : workspace.discovery.state === 'cancelled'
                        ? `The scan was cancelled after ${workspace.discovery.foldersScanned} folders; what it found is shown.`
                        : workspace.matched.length === 0
                          ? `No ${name(workspace.platform)} repositories were found under ${workspace.baseFolder}. Check the base folder and that its clones have a ${name(workspace.platform)} remote.`
                          : `${workspace.matched.length} repositories found in ${workspace.discovery.foldersScanned} folders.`}{' '}
                    <button type="button" data-testid="rescan-button" onClick={rescan}>
                      Rescan
                    </button>
                  </p>
                )}
                <ul class="list">
                  {workspace.matched.map((m) => (
                    <li key={m.repository} data-testid={`discovered-repo-${m.repository}`}>
                      <span class="mono">{m.repository}</span> <span class="muted">{m.folder}</span>
                      {m.duplicateFolders.map((d) => (
                        <p key={d} data-testid={`duplicate-folder-${d}`} class="muted">{`Also cloned in ${d}; the nearest clone is used.`}</p>
                      ))}
                    </li>
                  ))}
                  {workspace.skipped.map((k) => (
                    <li key={k.folder} data-testid={`skipped-folder-${k.folder}`} data-reason={k.reason}>
                      <span class="mono">{k.folder}</span> <span class="muted">{`skipped: ${k.reason}${k.detail !== undefined ? ` (${k.detail})` : ''}`}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </AsyncRegion>
          <AsyncRegion
            region="signins"
            label="the sign-ins"
            {...(signinsError !== null ? ({ state: 'failed', reason: signinsError, retry: () => setAttempt((n) => n + 1) } as const) : signins === null ? ({ state: 'loading' } as const) : ({ state: 'loaded' } as const))}
          >
            <section>
              <h2>Connection checklist</h2>
              <ul class="connection-checklist" data-testid="connection-checklist">
                {checks.map((c) => (
                  <li key={c.id} data-testid={c.testid} data-status={c.status}>
                    <span aria-hidden="true">{GLYPH[c.status]} </span>
                    <span>{c.status === 'not-checked' ? `? not checked yet: ${c.detail}, waiting for ${c.waitsFor}` : c.detail}</span>
                    {c.nextStep !== undefined && (
                      <>
                        {' '}
                        <a href="#/signin">{c.nextStep}</a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </AsyncRegion>
        </>
      )}
    </section>
  );
}
