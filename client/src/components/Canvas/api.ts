import type { CanvasBlock, CanvasDocument, CanvasEditOperation, CanvasSelection } from './types';

/**
 * The single seam between the Canvas editor and whatever rewrites a selection.
 * The editor is written against this interface and receives an implementation
 * as a prop, so it never imports a transport, a data-provider endpoint or a
 * React Query hook. A real backend adapter and the in-memory reference below
 * are interchangeable.
 */

/** What an AI edit resolves to: the operations the reducer should apply. */
export type EditSelectionResult = CanvasEditOperation[];

export type EditSelectionFn = (
  selection: CanvasSelection,
  instruction: string,
  signal: AbortSignal,
) => Promise<EditSelectionResult>;

export type InMemoryEditSelectionOptions = {
  /** Artificial latency before the edit resolves; useful for loading states. */
  delayMs?: number;
};

function abortError(): Error {
  const error = new Error('Canvas edit aborted');
  error.name = 'AbortError';
  return error;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Deterministic, dependency-free transformation used by the reference
 * `editSelection`. Exported so tests and integrators can predict the result:
 * a recognised instruction rewrites the selected text, anything else appends
 * the instruction in parentheses so the round trip is still observable.
 */
export function applyInstructionToSelection(
  selection: CanvasSelection,
  instruction: string,
): CanvasEditOperation[] {
  const trimmed = instruction.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const lower = trimmed.toLowerCase();
  let text: string;
  if (lower.includes('uppercase') || lower.includes('shout')) {
    text = selection.text.toUpperCase();
  } else if (lower.includes('lowercase')) {
    text = selection.text.toLowerCase();
  } else if (lower.includes('reverse')) {
    text = selection.text.split('').reverse().join('');
  } else {
    text = `${selection.text} (${trimmed})`;
  }
  return [
    {
      type: 'replace_selection',
      blockId: selection.blockId,
      start: selection.start,
      end: selection.end,
      text,
    },
  ];
}

/**
 * A deterministic, dependency-free reference `editSelection`.
 *
 * It exists so the editor and its tests can exercise the inline AI flow without
 * a backend, and so integrators have a working default to swap out. It rejects
 * promptly when the caller aborts and, like the Deep Research executor, leaves
 * latency configurable (zero by default) so tests run instantly.
 */
export function createInMemoryEditSelection(
  options: InMemoryEditSelectionOptions = {},
): EditSelectionFn {
  const delayMs = options.delayMs ?? 0;
  return async (selection, instruction, signal) => {
    await delay(delayMs, signal);
    if (signal.aborted) {
      throw abortError();
    }
    return applyInstructionToSelection(selection, instruction);
  };
}

/** A small starter document, handy for tests and the mount snippet. */
export function createSampleDocument(): CanvasDocument {
  const blocks: CanvasBlock[] = [
    { id: 'block-1', kind: 'heading', text: 'Canvas workspace' },
    {
      id: 'block-2',
      kind: 'paragraph',
      text: 'Select any text here, then ask for an inline AI edit.',
    },
  ];
  return {
    id: 'document-1',
    title: 'Untitled document',
    blocks,
    updatedAt: new Date(0).toISOString(),
  };
}
