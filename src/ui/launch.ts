// Launch page script (research R3, contracts/http-api.md `GET /launch.js`).
// The launch URL is `/launch#<token>`. The fragment never reaches the server,
// so this script reads it, clears it from the address bar and history, and
// exchanges it for the session cookie with `POST /api/auth`. On success it
// navigates to the workbench at `/`. It is served as a static file with no
// inline script, so it runs under the strict Content-Security-Policy.

const STATUS_ID = 'launch-status';

function showStatus(message: string): void {
  const el = document.getElementById(STATUS_ID);
  if (el !== null) el.textContent = message;
}

function readToken(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function clearFragment(): void {
  // Replace the current history entry so the token is not kept in history.
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

async function launch(): Promise<void> {
  const token = readToken(location.hash);
  clearFragment();

  if (token === '') {
    showStatus('This launch link has no sign-in token. Open the link printed in the terminal.');
    return;
  }

  let response: Response;
  try {
    response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    showStatus('The workbench server could not be reached. Check that it is still running.');
    return;
  }

  if (!response.ok) {
    showStatus('This launch link is not valid for the running workbench. Open the link printed in the terminal.');
    return;
  }

  // Replace, so Back does not return to the launch page.
  location.replace('/');
}

void launch();
