// Diagnoses Bitbucket Cloud and Jira Cloud connectivity/auth. Never prints secret values.
// Usage: node --env-file=.env testing/diagnose-atlassian.mjs [https://your-site.atlassian.net]
// Reads: BITBUCKET_USERNAME, JIRA_EMAIL, JIRA_API_TOKEN, BB_TOKEN_PR (+ optional JIRA_SITE).

import dns from 'node:dns/promises';

const env = process.env;
const site = (process.argv[2] || env.JIRA_SITE || '').replace(/\/+$/, '');
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

function describe(name) {
  const v = env[name];
  if (v === undefined) return `${name}: MISSING (not set)`;
  const notes = [];
  if (v === '') notes.push('EMPTY');
  if (v !== v.trim()) notes.push('has leading/trailing whitespace');
  if (/^["'].*["']$/.test(v)) notes.push('wrapped in quotes (dotenv parsers may keep them)');
  if (/[\r\n]/.test(v)) notes.push('contains newline');
  if (name.endsWith('EMAIL') || name.endsWith('USERNAME')) notes.push(v.includes('@') ? 'looks like an email' : 'NOT an email');
  else notes.push(`length ${v.length}`, `prefix "${v.slice(0, 5)}…"`);
  return `${name}: set (${notes.join(', ')})`;
}

async function call(label, url, headers) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000), redirect: 'manual' });
    let detail = '';
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j.displayName || j.username || j.error?.message || j.message || (j.errorMessages || []).join('; ') || '';
    } catch { /* non-JSON */ }
    const scopes = res.headers.get('x-oauth-scopes');
    const hint = res.headers.get('www-authenticate');
    console.log(`  ${res.status} ${res.statusText}  ${label}${detail ? `  -> ${detail}` : ''}${scopes ? `  [scopes: ${scopes}]` : ''}${res.status === 401 && hint ? `  [www-authenticate: ${hint}]` : ''}${res.status >= 300 && res.status < 400 ? `  [redirect to ${res.headers.get('location')}]` : ''}`);
    return res.status;
  } catch (e) {
    console.log(`  FAIL  ${label}  -> ${e.cause?.code || e.name}: ${e.message}`);
    return 0;
  }
}

console.log('== Environment ==');
['BITBUCKET_USERNAME', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'BB_TOKEN_PR'].forEach((n) => console.log('  ' + describe(n)));
console.log(`  Jira site: ${site || 'NOT PROVIDED (pass as arg or set JIRA_SITE)'}`);

console.log('\n== Network ==');
for (const host of ['api.bitbucket.org', ...(site ? [new URL(site).host] : [])]) {
  try { console.log(`  DNS ok ${host} -> ${(await dns.lookup(host)).address}`); } catch (e) { console.log(`  DNS FAIL ${host}: ${e.code}`); }
}
console.log(`  Proxy env: ${['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY'].filter((k) => env[k]).join(', ') || 'none (note: Node fetch ignores proxy vars unless NODE_USE_ENV_PROXY=1)'}`);

console.log('\n== Bitbucket Cloud (https://api.bitbucket.org/2.0) ==');
const BB = 'https://api.bitbucket.org/2.0';
await call('anonymous /repositories (connectivity only)', `${BB}/repositories?pagelen=1`, {});
const bbCombos = [
  ['Basic BITBUCKET_USERNAME + JIRA_API_TOKEN', env.BITBUCKET_USERNAME && env.JIRA_API_TOKEN && basic(env.BITBUCKET_USERNAME, env.JIRA_API_TOKEN)],
  ['Basic JIRA_EMAIL + JIRA_API_TOKEN', env.JIRA_EMAIL && env.JIRA_API_TOKEN && basic(env.JIRA_EMAIL, env.JIRA_API_TOKEN)],
  ['Basic BITBUCKET_USERNAME + BB_TOKEN_PR', env.BITBUCKET_USERNAME && env.BB_TOKEN_PR && basic(env.BITBUCKET_USERNAME, env.BB_TOKEN_PR)],
  ['Basic JIRA_EMAIL + BB_TOKEN_PR', env.JIRA_EMAIL && env.BB_TOKEN_PR && basic(env.JIRA_EMAIL, env.BB_TOKEN_PR)],
  ['Bearer BB_TOKEN_PR (repo/workspace access token)', env.BB_TOKEN_PR && `Bearer ${env.BB_TOKEN_PR}`],
];
for (const [label, auth] of bbCombos) {
  if (!auth) { console.log(`  skip  ${label} (missing input)`); continue; }
  await call(`/user: ${label}`, `${BB}/user`, { authorization: auth });
  await call(`/workspaces: ${label}`, `${BB}/workspaces?pagelen=1`, { authorization: auth });
}

console.log('\n== Jira Cloud ==');
if (!site) {
  console.log('  skipped: no site URL');
} else {
  if (!/^https:\/\/[^/]+\.atlassian\.net$/.test(site)) console.log(`  WARNING: site should look like https://<name>.atlassian.net, got ${site}`);
  if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
    const h = { authorization: basic(env.JIRA_EMAIL, env.JIRA_API_TOKEN) };
    await call('/rest/api/3/myself (auth check)', `${site}/rest/api/3/myself`, h);
    await call('/rest/api/3/project/search (browse permission)', `${site}/rest/api/3/project/search?maxResults=1`, h);
  } else {
    console.log('  skipped: JIRA_EMAIL or JIRA_API_TOKEN missing');
  }
}

console.log(`
== How to read this ==
  401  credentials rejected: wrong email/username, expired/revoked token, or token type mismatch.
  403  authenticated but missing scope/permission (scoped API tokens need read:user etc.; Bitbucket needs read:repository / read:pullrequest).
  404 on /user with a Bearer token is normal for repo/workspace access tokens (no user) - try a repo URL instead.
  FAIL / DNS FAIL  network, proxy or VPN problem rather than credentials.
  Bitbucket app passwords are retired; use an Atlassian API token with the account EMAIL, or a Bearer access token.
`);
