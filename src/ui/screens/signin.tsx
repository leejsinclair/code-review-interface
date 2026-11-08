// Sign-in screen (`#/signin`, FR-040): one form per configured platform, built from the sign-in
// fields `/api/platforms` describes, so no platform is named here. The secret input is a password
// field whose value is cleared after every attempt and never shown back.

import { useEffect, useState } from 'preact/hooks';
import type { SignIn } from '../../contracts/http.ts';
import type { AdapterDescriptor } from '../../contracts/shared.ts';
import { ApiError, getPlatforms, listSignIns, signIn } from '../api.ts';

const STATE_LABELS: Record<SignIn['state'], string> = {
  'signed-in': 'Signed in',
  'signed-out': 'Not signed in',
  expired: 'Sign-in expired: sign in again',
};

function SignInForm(props: { descriptor: AdapterDescriptor; current: SignIn | undefined; onDone: (s: SignIn) => void }) {
  const { descriptor, current } = props;
  const [account, setAccount] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = descriptor.signInFields.some((f) => f.name === 'account') ? { account: account.trim(), secret } : { secret };
    try {
      props.onDone(await signIn(descriptor.id, body));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'The sign-in was not accepted.');
    } finally {
      setSecret('');
      setBusy(false);
    }
  };

  return (
    <form class="panel stack" data-testid={`signin-form-${descriptor.id}`} onSubmit={submit}>
      <h2>{descriptor.displayName}</h2>
      <p class="muted" data-state={current?.state ?? 'signed-out'}>
        {STATE_LABELS[current?.state ?? 'signed-out']}
        {current?.account !== undefined ? ` (${current.account})` : ''}
      </p>
      {descriptor.signInFields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.secret ? (
            <input
              type="password"
              autocomplete="off"
              value={secret}
              onInput={(e) => setSecret((e.currentTarget as HTMLInputElement).value)}
              required
            />
          ) : (
            <input type="text" value={account} onInput={(e) => setAccount((e.currentTarget as HTMLInputElement).value)} required />
          )}
        </label>
      ))}
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <button class="button" type="submit" disabled={busy}>
        Sign in
      </button>
    </form>
  );
}

export function SignInScreen() {
  const [descriptors, setDescriptors] = useState<AdapterDescriptor[]>([]);
  const [signins, setSignins] = useState<SignIn[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getPlatforms(), listSignIns()])
      .then(([platforms, list]) => {
        const configured = new Set(list.map((s) => s.platform));
        setDescriptors(platforms.descriptors.filter((d) => configured.has(d.id)));
        setSignins(list);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the sign-ins.'));
  }, []);

  const done = (updated: SignIn): void => setSignins((list) => list.map((s) => (s.platform === updated.platform ? updated : s)));

  return (
    <section class="stack" data-testid="signin">
      <h1 class="page-header">Sign in</h1>
      {error !== null && <p class="error">{error}</p>}
      {descriptors.map((d) => (
        <SignInForm key={d.id} descriptor={d} current={signins.find((s) => s.platform === d.id)} onDone={done} />
      ))}
      <a class="button" href="#/">
        Continue
      </a>
    </section>
  );
}
