import { useCallback, useContext } from 'react';
import type { TMessage } from 'librechat-data-provider';
import { requestDiyaTurn } from '~/components/Voice/api';
import { ChatContext } from '~/Providers/ChatContext';
import { useAuthToken } from '~/hooks/AuthContext';

/** How long a spoken turn waits for the chat to produce a reply. */
const REPLY_TIMEOUT_MS = 180000;
const POLL_MS = 500;

/**
 * Routes a Diya turn through the REAL chat pipeline when one is mounted.
 *
 * The spoken exchange becomes normal chat messages (both sides recorded in the
 * thread, every model lane, tool and web search available), and the finished
 * assistant reply is returned so the orb can speak it. Shared by the header
 * overlay and the `/voice` page.
 *
 * Outside a chat provider (a bare route mount, tests) it falls back to the
 * stateless Diya endpoint instead of throwing.
 */
export default function useDiyaChatTurn() {
  const chat = useContext(ChatContext);
  const token = useAuthToken();
  const ask = chat?.ask;
  const getMessages = chat?.getMessages;

  return useCallback(
    async (
      text: string,
      history: { role: 'user' | 'assistant'; content: string }[],
      signal: AbortSignal,
      language?: string,
    ) => {
      if (!ask || !getMessages) {
        return requestDiyaTurn(text, history, signal, token ?? undefined, language);
      }
      const before = getMessages()?.length ?? 0;
      const accepted = ask({ text });
      if (accepted === false) {
        return 'Sorry, that message could not be sent.';
      }
      const deadline = Date.now() + REPLY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (signal.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        const messages: TMessage[] = getMessages() ?? [];
        const fresh = messages.slice(before);
        const failed = fresh.find((message) => message.error === true);
        if (failed) {
          return typeof failed.text === 'string' && failed.text
            ? failed.text
            : 'Sorry, that did not go through. Please try again.';
        }
        const reply = fresh.filter((message) => message.isCreatedByUser !== true).pop();
        if (
          reply &&
          reply.unfinished !== true &&
          typeof reply.text === 'string' &&
          reply.text.trim()
        ) {
          return reply.text;
        }
      }
      return 'Sorry, that took too long. Please try again.';
    },
    [ask, getMessages, token],
  );
}
