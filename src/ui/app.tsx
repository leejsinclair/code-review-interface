// Hash router composing every screen (contracts/ui.md). `#/setup` comes first while no configuration
// is saved (FR-039); `#/signin` is reached when any call answers `signin_required`, since api.ts sets
// the hash (FR-040). Each route change remounts its screen, so a screen loads for the ids it is given.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getConfig } from './api.ts';
import { SummariesPanel } from './components/summaries.tsx';
import { AskScreen } from './screens/ask.tsx';
import { CodeScreen } from './screens/code.tsx';
import { DescriptionScreen } from './screens/description.tsx';
import { DiffScreen } from './screens/diff.tsx';
import { HomeScreen } from './screens/home.tsx';
import { IssueScreen } from './screens/issue.tsx';
import { OverviewScreen } from './screens/overview.tsx';
import { SetupScreen } from './screens/setup.tsx';
import { SignInScreen } from './screens/signin.tsx';

function screenFor(hash: string) {
  const [pathText = '', queryText = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  const query = new URLSearchParams(queryText);
  const [first, sessionId, view, ...rest] = pathText.split('/').filter((s) => s !== '').map(decodeURIComponent);

  if (first === 'setup') return <SetupScreen />;
  if (first === 'signin') return <SignInScreen />;
  if (first !== 'sessions' || sessionId === undefined) return <HomeScreen />;
  switch (view) {
    case undefined:
      return <OverviewScreen sessionId={sessionId}>{(detail) => <SummariesPanel sessionId={sessionId} detail={detail} />}</OverviewScreen>;
    case 'diff':
      return <DiffScreen sessionId={sessionId} path={query.get('path') ?? ''} />;
    case 'code': {
      const line = Number(query.get('line'));
      return (
        <CodeScreen
          sessionId={sessionId}
          snapshotId={query.get('snapshot') ?? ''}
          side={query.get('side') === 'base' ? 'base' : 'head'}
          path={query.get('path') ?? ''}
          {...(Number.isInteger(line) && line > 0 ? { line } : {})}
        />
      );
    }
    case 'issues':
      if (rest.length === 2) return <IssueScreen sessionId={sessionId} platform={rest[0]!} issueKey={rest[1]!} />;
      break;
    case 'description':
      return <DescriptionScreen sessionId={sessionId} />;
    case 'ask':
      return <AskScreen sessionId={sessionId} query={query} />;
  }
  return <HomeScreen />;
}

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
      <header class="app-header">
        <h1 class="app-title">
          <a href="#/">PR Review Workbench</a>
        </h1>
        <span class="spacer" />
        <a href="#/setup">Setup</a>
        <a href="#/signin">Sign-in</a>
      </header>
      <main class="app-main" key={hash}>
        {ready ? screenFor(hash) : <p class="muted">Loading…</p>}
      </main>
    </>
  );
}

render(<App />, document.getElementById('app')!);
