// Which environment variables carry each platform's sign-in, for machines with no OS keychain.
// Returns the credential JSON credentials.ts stores ({account, secret, scheme}), or null.
// Env credentials are marked write-scoped: putting a token in .env is the opt-in, and there is no in-app sign-in to ask again.

type Env = Readonly<Record<string, string | undefined>>;

const first = (env: Env, names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
};

const basic = (env: Env, accounts: readonly string[], secrets: readonly string[]): string | null => {
  const account = first(env, accounts);
  const secret = first(env, secrets);
  return account !== undefined && secret !== undefined ? JSON.stringify({ account, secret, scheme: 'basic', scope: 'write' }) : null;
};

export function envCredential(platform: string, env: Env): string | null {
  if (platform === 'bitbucket-cloud') return basic(env, ['BITBUCKET_USERNAME', 'BITBUCKET_EMAIL'], ['BITBUCKET_API_TOKEN', 'BB_TOKEN_PR']);
  if (platform === 'jira-cloud') return basic(env, ['JIRA_EMAIL'], ['JIRA_API_TOKEN']);
  return null;
}
