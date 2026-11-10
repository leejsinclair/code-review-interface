// Wireframe helper: applies ?theme=light|dark and ?notes=0 from the viewer, and fills the shared app
// header and review shell so every screen shows the same frame. Not product code.
(function () {
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  const theme = q.get('theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  if (q.get('notes') === '0') root.classList.add('wf-hide-notes');
  const keep = location.search; // links keep the viewer's theme and notes choice
  const href = (page) => page + keep;

  // Which mockups the Settings menu and the sign-in badge open, by the platform this page shows.
  const pagesFor = (repo) => /Bitbucket/.test(repo || '')
    ? { setup: 'setup-bitbucket.html', signin: 'signin-bitbucket.html' }
    : { setup: 'setup-github.html', signin: 'signin.html' };

  const menu = (id, label, focus, items, open) => `
    <span class="menu-wrap">
      <button type="button" id="${id}" aria-haspopup="menu" aria-expanded="${open}" aria-controls="${id}-menu" data-focus="${focus}">${label} ▾</button>
      <div class="menu" role="menu" id="${id}-menu" aria-labelledby="${id}"${open ? '' : ' hidden'}>${items}</div>
    </span>`;

  const conn = (d) => ({
    ok: '<span class="badge" data-status="found">✓ Signed in</span> <span class="badge" data-status="found">✓ AI provider ready</span>',
    signin: '<a href="' + href(pagesFor(d.repo).signin) + '" class="badge" data-status="missing" data-focus="2a">✕ Sign-in required</a>',
    provider: '<span class="badge" data-status="found">✓ Signed in</span> <span class="badge" data-status="missing">✕ AI provider unavailable</span>',
  })[d.conn || 'ok'];

  const appHeader = (d) => `
    <a class="skip-link" href="#content" data-focus="1">Skip to content</a>
    <header class="app-header">
      <a href="${href('home.html')}" data-focus="2">PR Review Workbench</a>
      <span class="repo mono" title="Workspace">${d.repo || 'GitHub · ~/src · 12 repositories'}</span> <span class="wf-new">[NEW]</span>
      <span class="conn">${conn(d)}</span> <span class="wf-new">[NEW]</span>
      <span class="spacer"></span>
      ${menu('settings', 'Settings', 3, `
        <a role="menuitem" href="${href(pagesFor(d.repo).setup)}">Setup</a>
        <a role="menuitem" href="${href(pagesFor(d.repo).signin)}">Sign-in</a>`, false)}
    </header>
    <p class="wf-note">Skip link is shown here for review; in the product it appears on first Tab. Settings menu holds Setup and Sign-in. Workspace (platform, base folder, repositories found) and connection state come from the server (platform display names are data, never hard-coded).</p>`;

  const tab = (name, label, page, current, focus) =>
    `<a href="${href(page)}" data-focus="${focus}"${current === name ? ' aria-current="page"' : ''}>${label}</a>`;

  const reviewShell = (d) => {
    const readOnly = d.readonly === 'true';
    const refresh = readOnly
      ? '<p class="notice" data-testid="read-only-notice">This PR is merged; the session is read-only. Refresh and Ask are unavailable.</p>'
      : d.newcommits === 'true'
        ? '<button type="button" class="primary" data-testid="refresh-button" data-focus="4">New commits — Refresh</button>'
        : '<button type="button" data-testid="refresh-button" data-focus="4">Refresh</button>';
    const paused = d.paused === 'true'
      ? '<div class="banner" role="status">Live updates paused — <button type="button" data-focus="3a">Reconnect</button></div>'
      : '';
    const ask = d.ask === 'none' ? '' : readOnly
      ? '<span class="spacer"></span><button type="button" aria-disabled="true" aria-describedby="ask-why" data-focus="10">Ask about this PR</button> <span id="ask-why" class="reason">Read-only: the PR is merged.</span>'
      : '<span class="spacer"></span><button type="button" class="primary" data-focus="10">Ask about this PR</button>';
    return `
    <div class="review-shell">
      ${paused}
      <div class="review-header">
        <div>
          <p><a href="${href('home.html')}" data-focus="3b">‹ Back to dashboard</a> <span class="wf-new">[NEW]</span></p>
          <p class="pr-title"><span class="mono">#482</span> Retry failed webhook deliveries with backoff</p>
          <p class="meta"><span class="mono">acme/payments-api</span> · a.khan · <span class="mono">feature/webhook-retry → main</span> · head <span class="mono">3f9c2a1</span> · snapshot 14:02</p>
        </div>
        <span class="badge" data-testid="session-status">${readOnly ? '■ Merged' : '● Open'}</span>
        <span class="spacer"></span>
        ${refresh}
        ${menu('session-actions', 'Session actions', 5, `
          <a role="menuitem" href="${href('home.html')}">Close session</a>
          <a role="menuitem" class="danger-text" href="${href('delete-dialog.html')}">Delete session…</a>`, d.menu === 'open')}
      </div>
      <nav class="review-nav" aria-label="Review">
        ${tab('overview', 'Overview', 'overview.html', d.tab, 6)}
        ${tab('files', 'Files', 'diff.html', d.tab, 7)}
        ${tab('questions', 'Questions <span class="badge">3</span> <span class="badge" data-status="stale">◐ 1 running</span>', 'questions.html', d.tab, 8)}
        ${tab('sources', 'Sources', 'description.html', d.tab, 9)}
        ${ask}
      </nav>
      <div class="context-strip" aria-label="Context available">
        <span>Context available:</span>
        <span class="badge" data-status="found">✓ Description</span>
        <span class="badge" data-status="found">✓ 2 issues</span>
        <span class="badge" data-status="missing">✕ 1 issue missing</span>
        <span class="badge">⊘ 3 files skipped</span>
        <a href="${href('overview.html')}#context" data-focus="11">Details</a>
      </div>
    </div>`;
  };

  const templates = { 'app-header': appHeader, 'review-shell': reviewShell };
  document.querySelectorAll('[data-wf]').forEach((el) => {
    el.outerHTML = templates[el.dataset.wf](el.dataset);
  });

  // Menus open on click, close on Escape (focus back to the button) or a click elsewhere.
  const close = (button) => {
    button.setAttribute('aria-expanded', 'false');
    document.getElementById(button.getAttribute('aria-controls')).hidden = true;
  };
  const openButtons = () => [...document.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]')];
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[aria-haspopup="menu"]');
    openButtons().filter((b) => b !== button).forEach(close);
    if (!button) return;
    const list = document.getElementById(button.getAttribute('aria-controls'));
    const opening = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(opening));
    list.hidden = !opening;
    if (opening) list.querySelector('[role="menuitem"]').focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    openButtons().forEach((b) => { close(b); b.focus(); });
  });

  // Form fields cannot draw ::before, so their focus number moves to the enclosing label (or parent).
  document.querySelectorAll('input[data-focus], select[data-focus], textarea[data-focus]').forEach((field) => {
    const host = field.closest('label') || (field.id && document.querySelector(`label[for="${field.id}"]`)) || field.parentElement;
    if (!host.hasAttribute('data-focus')) host.dataset.focus = field.dataset.focus;
  });
})();
