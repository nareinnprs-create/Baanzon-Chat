import { useState } from 'react';
import { Provider } from 'jotai';
import { AudioLines } from 'lucide-react';
import { TooltipAnchor, Button } from '@librechat/client';
import { VOICE_LABELS as L } from '~/components/Voice/labels';
import VoicePanel from '~/components/Voice/VoicePanel';
import useDiyaChatTurn from '~/components/Voice/useDiyaChatTurn';
import { announceDiyaOpen } from '~/components/Voice/events';
import { primeOutput } from '~/utils/voice/output';
import { cn } from '~/utils';

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
  const chatTurn = useDiyaChatTurn();

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
            onClick={() => {
              // Unlock audio inside the tap: the panel auto-starts from an
              // effect, where the gesture has already expired on iOS.
              primeOutput();
              announceDiyaOpen();
              setOpen((value) => !value);
            }}
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
          className="fixed inset-0 z-[70] flex flex-col bg-surface-primary"
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
