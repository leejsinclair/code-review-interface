// AI registry (research R12, FR-023): the one place that names the AI provider and maps its id to
// the provider factory. Core, server and UI code know the provider only through `AiProvider` and
// this id, which `/api/platforms` lists.

import type { AiProvider } from '../contracts/ai-provider.ts';
import { createClaudeCodeCliProvider, PROVIDER_ID } from './claude-code-cli/provider.ts';

export type AiProviderOptions = {
  /** `<app-data>/provider-home`. */
  providerHome: string;
};

const PROVIDERS: ReadonlyMap<string, (options: AiProviderOptions) => AiProvider> = new Map([[PROVIDER_ID, createClaudeCodeCliProvider]]);

export class UnknownAiProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`unknown AI provider: ${provider}`);
    this.name = 'UnknownAiProviderError';
    this.provider = provider;
  }
}

/** Registered AI provider ids. */
export function registeredAiProviders(): string[] {
  return [...PROVIDERS.keys()];
}

export function createAiProvider(id: string, options: AiProviderOptions): AiProvider {
  const create = PROVIDERS.get(id);
  if (create === undefined) throw new UnknownAiProviderError(id);
  return create(options);
}
