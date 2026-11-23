import { useCallback, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { Provider } from 'jotai';
import { TooltipAnchor, Button } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import VoicePanel from '~/components/Voice/VoicePanel';
import { VOICE_LABELS as L } from '~/components/Voice/labels';
import { useChatContext } from '~/Providers';
import { cn } from '~/utils';

const REPLY_TIMEOUT_MS = 180000;
const POLL_MS = 500;

/**
 * ChatGPT-style voice entry: a header button that opens the Diya session as a
 * full-screen overlay on top of the chat.
 *
 * Voice turns ride the REAL chat pipeline: the spoken exchange is submitted
 * through the normal chat (so both sides are recorded in the thread and every
 * model lane, web search and tool stays available), and the finished assistant
 * reply is spoken back. Closing the overlay tears the session down, so closing
 * always ends the call.
 */
export default function HeaderVoiceButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { ask, getMessages } = useChatContext();

  const chatTurn = useCallback(
    async (text: string): Promise<string> => {
      const before = getMessages()?.length ?? 0;
      const accepted = ask({ text });
      if (accepted === false) {
        return 'Sorry, that message could not be sent.';
      }
      const deadline = Date.now() + REPLY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
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
    [ask, getMessages],
  );

  return (
    <>
      <TooltipAnchor
        description={L.title}
        render={
          <Button
            size="icon"
            variant="outline"
            aria-label={L.title}
            aria-pressed={open}
            data-testid="header-voice-button"
            onClick={() => setOpen((value) => !value)}
            className={cn(
              'size-9 flex-shrink-0 rounded-xl bg-presentation hover:bg-surface-active-alt',
              className,
            )}
          >
            <AudioLines className="icon-md" aria-hidden="true" />
          </Button>
        }
      />
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={L.title}
          data-testid="voice-overlay"
          className="fixed inset-0 z-50 flex flex-col bg-surface-primary"
        >
          <Provider>
            <VoicePanel
              variant="overlay"
              autoStart
              turn={chatTurn}
              onClose={() => setOpen(false)}
              className="flex-1"
            />
          </Provider>
        </div>
      )}
    </>
  );
}
