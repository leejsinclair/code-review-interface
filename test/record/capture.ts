// Recording preload (T067; FR-041, FR-042, SC-009). NOT a test: it lives outside every test glob.
//
//   PRWB_RECORD_FIXTURES=/tmp/rec/gitlab PRWB_RECORD_ALIAS_REVIEWER=<real signed-in handle> \
//   PRWB_RECORD_ALIAS_AUTHOR=<real author handle> PRWB_RECORD_ALIAS_WORKSPACE=<real workspace or owner> \
//   node --import ./test/record/capture.ts src/main.ts
//
// It refuses to start without the output folder and all three alias variables, then replaces the global
// `fetch` with `recordingFetch`, so every request the app makes is saved as a fixture with secrets
// replaced by `[redacted]` and the real names replaced by the placeholders `alice-dev`, `bob-dev` and
// `test-workspace`. It changes no product file: the app reads the global `fetch` when it starts.

import { ALIAS_PLACEHOLDERS, recordingFetch } from '../helpers/recorded-fetch.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** Environment variables whose values are credentials, plus any listed in PRWB_RECORD_SECRETS (comma separated). */
const SECRET_VARIABLES = ['GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN', 'BITBUCKET_API_TOKEN', 'BB_TOKEN_PR', 'JIRA_API_TOKEN'] as const;

const ALIAS_VARIABLES = [
  ['PRWB_RECORD_ALIAS_REVIEWER', ALIAS_PLACEHOLDERS[0]],
  ['PRWB_RECORD_ALIAS_AUTHOR', ALIAS_PLACEHOLDERS[1]],
  ['PRWB_RECORD_ALIAS_WORKSPACE', ALIAS_PLACEHOLDERS[2]],
] as const;

export type CaptureSetup = { dir: string; secrets: string[]; aliases: Record<string, string> };

/** Reads the recording setup from `env`, or throws naming every missing variable. */
export function captureSetup(env: Env): CaptureSetup {
  const get = (name: string): string => env[name]?.trim() ?? '';
  const missing = ['PRWB_RECORD_FIXTURES', ...ALIAS_VARIABLES.map(([name]) => name)].filter((name) => get(name) === '');
  if (missing.length > 0) {
    throw new Error(`recording refused: set ${missing.join(', ')} (see test/record/README.md). Nothing was started.`);
  }
  const aliases: Record<string, string> = {};
  for (const [name, placeholder] of ALIAS_VARIABLES) {
    const real = get(name);
    if ((ALIAS_PLACEHOLDERS as readonly string[]).includes(real)) {
      throw new Error(`recording refused: ${name} is already the placeholder "${real}"; it must be the REAL name to replace.`);
    }
    aliases[real] = placeholder;
  }
  const secrets = [...SECRET_VARIABLES.map(get), ...get('PRWB_RECORD_SECRETS').split(',').map((s) => s.trim())].filter((s) => s !== '');
  return { dir: get('PRWB_RECORD_FIXTURES'), secrets, aliases };
}

const setup = captureSetup(process.env);
const real = globalThis.fetch.bind(globalThis);
globalThis.fetch = recordingFetch(real, setup) as typeof fetch;
console.error(`[record] saving fixtures to ${setup.dir}; ${setup.secrets.length} secret(s) and ${Object.keys(setup.aliases).length} name(s) will be replaced`);
