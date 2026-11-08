// Neutral AI provider contract (contracts/provider-contracts.md, "AiProvider").
// Core builds the prompt (fixed instructions plus a delimited data block, R14) and validates the
// structured output (R13); the provider only runs it. The provider's registry id lives with its
// adapter under src/adapters/, so this file names no provider (VO-036).

/** The FR-022 restrictions a provider reports on. */
export type RestrictionId =
  /** FR-022 (a). */
  | 'workspace-read-search-tools-only'
  /** FR-022 (b). */
  | 'no-reads-outside-workspace'
  /** FR-022 (c). Unenforced: interrogation and summaries are unavailable. */
  | 'no-network-tools'
  /** FR-022 (d). Unenforced: interrogation and summaries are unavailable. */
  | 'no-repository-configuration'
  /** FR-022 (e). Enforced by core's delimited data block. */
  | 'untrusted-input-delimited';

export const RESTRICTION_IDS: readonly RestrictionId[] = [
  'workspace-read-search-tools-only',
  'no-reads-outside-workspace',
  'no-network-tools',
  'no-repository-configuration',
  'untrusted-input-delimited',
];

/** Restrictions that, when not enforced, make the provider unavailable (FR-022 (c), (d)). */
export const BLOCKING_RESTRICTIONS: readonly RestrictionId[] = ['no-network-tools', 'no-repository-configuration'];

export type ProviderCapabilities = {
  installed: boolean;
  signedIn?: boolean;
  streaming: boolean;
  restrictionsEnforced: Record<RestrictionId, boolean>;
  unavailableReason?: string;
};

export type AskOutput = 'answer' | 'summary';

export type AskRequest = {
  requestId: string;
  /** The session's detached worktree, never the reviewer's own tree. */
  workspacePath: string;
  /** Fixed workbench text, passed as the system prompt. */
  instructions: string;
  /** `<<<PRWB-DATA nonce>>> ... <<<END nonce>>>`, passed on stdin. */
  data: string;
  /** Selects the output JSON schema. */
  output: AskOutput;
};

export type AskErrorCode = 'not_installed' | 'not_signed_in' | 'failed' | 'cancelled';

export type AskEvent =
  /** Raw streamed text, not yet checked (FR-021). */
  | { type: 'delta'; text: string }
  /** Structured output, validated by core (src/core/claims.ts). */
  | { type: 'result'; output: unknown }
  | { type: 'error'; code: AskErrorCode; message: string };

export interface AiProvider {
  /** The provider's registry id. */
  readonly id: string;
  capabilities(): Promise<ProviderCapabilities>;
  ask(req: AskRequest): AsyncIterable<AskEvent>;
  cancel(requestId: string): Promise<void>;
}
