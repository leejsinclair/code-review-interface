// Parser for the CLI's `--output-format stream-json` lines (research R12, R13).
//
// `stream_event` lines carrying a text delta (or a partial structured-output JSON delta) become raw
// `delta` text, published as in progress and not yet checked (FR-021). The `result` line carries the
// structured output when `--json-schema` was honoured; otherwise its text is passed on and core marks
// the answer unstructured. A `result` flagged as an error becomes an `error` event. Every other line
// (system, assistant, user, tool progress) and anything that is not JSON is ignored.

import type { AskEvent } from '../../contracts/ai-provider.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const NOT_SIGNED_IN = /not logged in|please run \/login|invalid api key|authentication/i;

/** One stdout line as an event, or null when the line carries nothing the workbench uses. */
export function parseStreamLine(line: string): AskEvent | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(message)) return null;

  if (message['type'] === 'stream_event') {
    const event = message['event'];
    if (!isRecord(event) || event['type'] !== 'content_block_delta' || !isRecord(event['delta'])) return null;
    const delta = event['delta'];
    if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') return { type: 'delta', text: delta['text'] };
    if (delta['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') return { type: 'delta', text: delta['partial_json'] };
    return null;
  }

  if (message['type'] === 'result') {
    const text = typeof message['result'] === 'string' ? message['result'] : '';
    if (message['is_error'] === true || (typeof message['subtype'] === 'string' && message['subtype'].startsWith('error'))) {
      const reason = text !== '' ? text : `the provider ended with ${String(message['subtype'] ?? 'an error')}`;
      return { type: 'error', code: NOT_SIGNED_IN.test(reason) ? 'not_signed_in' : 'failed', message: reason };
    }
    if (message['structured_output'] !== undefined) return { type: 'result', output: message['structured_output'] };
    try {
      return { type: 'result', output: JSON.parse(text) as unknown };
    } catch {
      return { type: 'result', output: text };
    }
  }
  return null;
}
