// App header (FR-014, FR-029, contracts 4.1): skip link, product link, the workspace's base folder and platform,
// the connection state, and a settings menu with Setup and Sign-in. A check that fails shows as unknown, never
// as a hidden state.

import { useEffect, useState } from 'preact/hooks';
import type { Platforms, ProviderStatus, SignIn, Workspace } from '../../contracts/http.ts';
import { getPlatforms, getProvider, getWorkspace, listSignIns } from '../api.ts';
import { DisclosureMenu } from './disclosure-menu.tsx';

type State = 'signed-in' | 'signin-required' | 'provider-unavailable' | 'unknown';

type Info = { workspace: Workspace | null; platforms: Platforms | null; signins: SignIn[] | null; provider: ProviderStatus | null; failed: boolean };

function connection(info: Info): { state: State; text: string } {
  if (info.signins === null || info.provider === null) return { state: 'unknown', text: info.failed ? 'Connection unknown' : 'Checking connection…' };
  if (info.signins.some((s) => s.state !== 'signed-in')) return { state: 'signin-required', text: 'Sign-in required' };
  if (!info.provider.available) return { state: 'provider-unavailable', text: 'AI provider unavailable' };
  return { state: 'signed-in', text: 'Signed in' };
}

export function AppHeader() {
  const [info, setInfo] = useState<Info>({ workspace: null, platforms: null, signins: null, provider: null, failed: false });
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const on = (): void => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  // Reload when the reviewer returns from Setup or Sign-in, where any of this may have changed.
  const settingsPage = /^#\/(setup|signin)/.test(hash);
  useEffect(() => {
    if (settingsPage) return;
    let live = true;
    const part = <K extends keyof Info>(key: K) => (value: Info[K]) => live && setInfo((cur) => ({ ...cur, [key]: value }));
    const fail = (): void => {
      if (live) setInfo((cur) => ({ ...cur, failed: true }));
    };
    getWorkspace().then(part('workspace')).catch(() => undefined);
    getPlatforms().then(part('platforms')).catch(() => undefined);
    listSignIns().then(part('signins')).catch(fail);
    getProvider().then(part('provider')).catch(fail);
    return () => {
      live = false;
    };
  }, [settingsPage]);

  const conn = connection(info);
  const platformName = info.platforms?.descriptors.find((d) => d.id === info.workspace?.platform)?.displayName ?? info.workspace?.platform;
  return (
    <header class="app-header" data-testid="app-header">
      <a
        class="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <a class="app-title" href="#/">
        PR Review Workbench
      </a>
      {info.workspace !== null && (
        <span data-testid="workspace-identity">{`Base folder ${info.workspace.baseFolder} · ${platformName ?? ''}`}</span>
      )}
      <span class="spacer" />
      <span data-testid="connection-state" data-state={conn.state}>
        {conn.text}
      </span>
      <DisclosureMenu id="settings-menu" label="Settings">
        <a href="#/setup">Setup</a>
        <a href="#/signin">Sign-in</a>
      </DisclosureMenu>
    </header>
  );
}
