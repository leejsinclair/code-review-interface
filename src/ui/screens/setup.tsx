// Set-up screen (`#/setup`, FR-039): repository platform and id, clone path, issue tracker platform,
// site and project keys, and limits. The server validates; its `invalid_request` and `unknown_field`
// messages name the field and are shown as text. Platforms are listed from `/api/platforms`.

import { useEffect, useState } from 'preact/hooks';
import type { ConfigBody, Platforms } from '../../contracts/http.ts';
import { ApiError, getConfig, getPlatforms, saveConfig } from '../api.ts';

type Form = {
  repoPlatform: string;
  repoId: string;
  clonePath: string;
  trackerPlatform: string;
  site: string;
  projectKeys: string;
  maxFileBytes: string;
  maxChangedLines: string;
  maxPromptChars: string;
};

const EMPTY: Form = {
  repoPlatform: '',
  repoId: '',
  clonePath: '',
  trackerPlatform: '',
  site: '',
  projectKeys: '',
  maxFileBytes: '1048576',
  maxChangedLines: '5000',
  maxPromptChars: '400000',
};

function toBody(form: Form): ConfigBody {
  const keys = form.projectKeys
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter((k) => k !== '');
  const issueTracker: ConfigBody['issueTracker'] = { platform: form.trackerPlatform };
  if (form.site.trim() !== '') issueTracker.site = form.site.trim();
  if (keys.length > 0) issueTracker.projectKeys = keys;
  return {
    repository: { platform: form.repoPlatform, id: form.repoId.trim(), clonePath: form.clonePath.trim() },
    issueTracker,
    limits: {
      maxFileBytes: Number(form.maxFileBytes),
      maxChangedLines: Number(form.maxChangedLines),
      maxPromptChars: Number(form.maxPromptChars),
    },
  };
}

export function SetupScreen() {
  const [platforms, setPlatforms] = useState<Platforms | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPlatforms()
      .then(setPlatforms)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load platforms.'));
    getConfig()
      .then((config) => {
        if (config === null) return;
        setForm({
          repoPlatform: config.repository.platform,
          repoId: config.repository.id,
          clonePath: config.repository.clonePath,
          trackerPlatform: config.issueTracker.platform,
          site: config.issueTracker.site ?? '',
          projectKeys: (config.issueTracker.projectKeys ?? []).join(', '),
          maxFileBytes: String(config.limits.maxFileBytes),
          maxChangedLines: String(config.limits.maxChangedLines),
          maxPromptChars: String(config.limits.maxPromptChars),
        });
      })
      .catch(() => undefined);
  }, []);

  const name = (id: string): string => platforms?.descriptors.find((d) => d.id === id)?.displayName ?? id;
  const field = (key: keyof Form) => ({
    value: form[key],
    onInput: (event: Event) => setForm({ ...form, [key]: (event.currentTarget as HTMLInputElement).value }),
  });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveConfig(toBody(form));
      location.hash = '#/signin';
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'The configuration could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section class="panel stack" data-testid="setup">
      <h1 class="page-header">Set up the workbench</h1>
      <form class="stack" onSubmit={submit}>
        <label>
          Repository platform
          <select {...field('repoPlatform')} required>
            <option value="">Choose…</option>
            {(platforms?.sourceControl ?? []).map((id) => (
              <option key={id} value={id}>
                {name(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Repository (owner/repo or workspace/repo)
          <input type="text" {...field('repoId')} required />
        </label>
        <label>
          Local clone path
          <input type="text" {...field('clonePath')} required />
        </label>
        <label>
          Issue tracker
          <select {...field('trackerPlatform')} required>
            <option value="">Choose…</option>
            {(platforms?.issueTrackers ?? []).map((id) => (
              <option key={id} value={id}>
                {name(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tracker site (when the tracker needs one)
          <input type="url" {...field('site')} />
        </label>
        <label>
          Project keys (comma separated)
          <input type="text" {...field('projectKeys')} />
        </label>
        <fieldset class="stack">
          <legend>Limits</legend>
          <label>
            Largest file in a prompt (bytes)
            <input type="number" min="1" {...field('maxFileBytes')} />
          </label>
          <label>
            Most changed lines per file
            <input type="number" min="1" {...field('maxChangedLines')} />
          </label>
          <label>
            Prompt budget (characters)
            <input type="number" min="1" {...field('maxPromptChars')} />
          </label>
        </fieldset>
        {error !== null && (
          <p class="error" role="alert" data-testid="setup-error">
            {error}
          </p>
        )}
        <button class="button" type="submit" disabled={saving}>
          Save
        </button>
      </form>
    </section>
  );
}
