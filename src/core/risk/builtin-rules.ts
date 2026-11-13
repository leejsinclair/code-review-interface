// The built-in mandatory-scrutiny rules (research RR-3). Rules are data: a rule is an ID, a family, the class
// a behavioural change under a matching path gets (`class`), the class a changed line that only mentions one of
// its terms gets (`floor`, null when terms do not apply), glob paths and case-insensitive line terms. The
// path lists are defaults to be tuned, not a spec; changing them is a data change. Mechanical rules (lockfile,
// generated, comment-only, rename-only) can lower a class and so are fixed in code, never extended by a file.

import type { RiskClass } from './classes.ts';

export type RuleFamily = 'authentication' | 'authorisation' | 'deletion' | 'financial' | 'migration' | 'configuration';

export type Rule = {
  id: string;
  family: RuleFamily;
  /** Shown in the reason text; fixed words, never pull-request text. */
  label: string;
  /** The class of a behavioural change in a file whose path matches. */
  class: RiskClass;
  /** The class of a behavioural changed line that mentions a term while the path does not match; null: none. */
  floor: RiskClass | null;
  paths: string[];
  lineTerms: string[];
  /** Paths a rule file added to this rule. A match on one of these lifts a test file above Normal; built-in paths never do. */
  filePaths?: string[];
};

/** Bumped when the built-in rules change; part of every snapshot's ruleset version. */
export const BUILTIN_RULESET_NUMBER = 2;

export const SENSITIVE_RULES: readonly Rule[] = [
  {
    id: 'R-AUTH', family: 'authentication', label: 'Authentication', class: 'critical', floor: 'elevated',
    paths: ['**/auth/**', '**/authn/**', '**/authentication/**', '**/login/**', '**/oauth/**', '**/sso/**', '**/jwt/**', '**/credentials/**', 'auth.*', 'authentication.*', 'login.*', 'password*'],
    lineTerms: ['password', 'passwd', 'credential', 'jwt', 'oauth', 'authenticate'],
  },
  {
    id: 'R-AUTHZ', family: 'authorisation', label: 'Authorisation', class: 'critical', floor: 'elevated',
    paths: ['**/authz/**', '**/authorization/**', '**/authorisation/**', '**/permissions/**', '**/permission/**', '**/rbac/**', '**/acl/**', '**/policies/**', 'authz.*', 'permissions.*', 'rbac.*'],
    lineTerms: ['isadmin', 'is_admin', 'permission', 'authorize', 'authorise', 'rbac'],
  },
  {
    id: 'R-DELETE', family: 'deletion', label: 'Deletion', class: 'critical', floor: 'elevated',
    paths: ['**/delete/**', '**/deletion/**', '**/purge/**', '**/erase/**', '**/retention/**', '**/gdpr/**', 'delete*.*', 'purge*.*'],
    lineTerms: ['delete from', 'drop table', 'drop database', 'truncate table', 'rm -rf'],
  },
  {
    id: 'R-FINANCE', family: 'financial', label: 'Financial calculation', class: 'critical', floor: 'elevated',
    paths: ['**/billing/**', '**/payment/**', '**/payments/**', '**/invoice/**', '**/invoicing/**', '**/ledger/**', '**/finance/**', '**/checkout/**', '**/pricing/**', 'payment*.*', 'billing*.*', 'invoice*.*'],
    lineTerms: ['invoice', 'ledger', 'payment', 'refund', 'currency'],
  },
  {
    id: 'R-MIGRATION', family: 'migration', label: 'Database migration', class: 'critical', floor: null,
    paths: ['**/migrations/**', '**/migrate/**', 'db/changelog/**', '**/db/changelog/**', '**/alembic/versions/**', '**/flyway/**', 'schema.sql'],
    lineTerms: [],
  },
  {
    id: 'R-CONFIG', family: 'configuration', label: 'Build, deployment or infrastructure configuration', class: 'elevated', floor: null,
    paths: [
      // CI definitions by shape, not by platform name (VIII.2): a dot-folder of workflows, `.<name>-ci.yml`, `<name>-pipelines.yml`.
      '.*/workflows/**', '.*-ci.yml', '*-pipelines.yml', 'Jenkinsfile', 'Dockerfile*', 'docker-compose*.yml', 'docker-compose*.yaml',
      '.devcontainer/**', '*.tf', '*.tfvars', '**/k8s/**', '**/helm/**', '*.bicep', 'cloudformation*',
    ],
    lineTerms: [],
  },
];

export const LOCKFILE_RULE = {
  id: 'R-LOCKFILE',
  label: 'Lockfile',
  paths: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', 'poetry.lock', 'Gemfile.lock', 'composer.lock', 'bun.lockb', '*.lock'],
} as const;

export const GENERATED_RULE = {
  id: 'R-GENERATED',
  label: 'Generated file',
  paths: ['dist/**', '**/dist/**', '*.min.js', '*.min.css', '*.generated.*', '*.g.dart', '*.pb.go', '__generated__/**', '**/__generated__/**'],
  /** Markers read from the first lines of a patch (its first hunk's context or added lines). */
  markers: ['@generated', 'do not edit', 'code generated'],
} as const;

/** A test file is capped at Normal by the rules; only the AI or a rule-file path can raise it. */
export const TEST_FILE_RULE = {
  id: 'R-TEST',
  label: 'Test file',
  paths: [
    '**/test/**', '**/tests/**', '**/__tests__/**', '**/__mocks__/**', '**/spec/**', '**/e2e/**',
    'test/**', 'tests/**', 'spec/**', 'e2e/**',
    '*.test.*', '*.spec.*', '*_test.*', '*_spec.*', 'test_*.py', '*Test.java', '*Tests.cs', 'conftest.py',
  ],
} as const;

export const COMMENT_ONLY_RULE = { id: 'R-COMMENT-ONLY', label: 'Comment-only or whitespace-only change' } as const;
export const RENAME_ONLY_RULE = { id: 'R-RENAME-ONLY', label: 'Rename with no change' } as const;
/** The rule-less reason of a file no rule matched (shows no rule ID). */
export const DEFAULT_RULE_ID = 'DEFAULT';
