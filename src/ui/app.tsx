// Hash router composing every screen (contracts 4.1, 4.2). The app header and `<main>` persist; every
// `#/sessions/:id…` route is wrapped in a review shell keyed by session id, so the session loads once and its
// stream and scroll survive moving between pages. `#/setup` comes first while no configuration is saved
// (FR-039); `#/signin` is reached when any call answers `signin_required`, since api.ts sets the hash (FR-040).

import { render } from 'preact';
import type { ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getConfig } from './api.ts';
import { AppHeader } from './components/app-header.tsx';
import { ReviewShell } from './components/review-shell.tsx';
import { AskScreen } from './screens/ask.tsx';
import { CodeScreen } from './screens/code.tsx';
import { DescriptionScreen } from './screens/description.tsx';
import { DiffScreen } from './screens/diff.tsx';
import { HomeScreen } from './screens/home.tsx';
import { IssueScreen } from './screens/issue.tsx';
import { OverviewScreen } from './screens/overview.tsx';
import { SetupScreen } from './screens/setup.tsx';
import { SignInScreen } from './screens/signin.tsx';
import { parseRoute } from './state/routes.ts';

function screenFor(hash: string): ComponentChild {
  const route = parseRoute(hash);
  switch (route.name) {
    case 'setup':
      return <SetupScreen />;
    case 'signin':
      return <SignInScreen />;
    case 'overview':
      return inShell(route.sessionId, <OverviewScreen key={hash} sessionId={route.sessionId} />);
    case 'diff':
      return inShell(route.sessionId, <DiffScreen key={hash} sessionId={route.sessionId} path={route.path ?? ''} focus={route.focus} />);
    case 'code':
      return inShell(route.sessionId, <CodeScreen key={hash} sessionId={route.sessionId} />);
    case 'description':
      return inShell(route.sessionId, <DescriptionScreen key={hash} sessionId={route.sessionId} />);
    case 'issue':
      return inShell(route.sessionId, <IssueScreen key={hash} sessionId={route.sessionId} platform={route.platform} issueKey={route.key} />);
    case 'ask':
      return inShell(route.sessionId, <AskScreen key={hash} sessionId={route.sessionId} query={route.query} />);
    default:
      return <HomeScreen />;
  }
}

const inShell = (sessionId: string, screen: ComponentChild): ComponentChild => (
  <ReviewShell key={sessionId} sessionId={sessionId}>
    {screen}
  </ReviewShell>
);

function App() {
  const [hash, setHash] = useState(location.hash);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onChange = (): void => setHash(location.hash);
    addEventListener('hashchange', onChange);
    getConfig()
      .then((config) => {
        if (config === null) location.hash = '#/setup';
      })
      .catch(() => undefined) // a sign-in failure has already moved the hash; any other shows on its screen
      .finally(() => setReady(true));
    return () => removeEventListener('hashchange', onChange);
  }, []);

  return (
    <>
      <AppHeader />
      <main id="main" tabIndex={-1} class="app-main">
        {ready ? screenFor(hash) : <p class="muted">Loading…</p>}
      </main>
    </>
  );
}

render(<App />, document.getElementById('app')!);
