import { useState } from 'react';
import { AudioLines } from 'lucide-react';
import { Provider } from 'jotai';
import { TooltipAnchor, Button } from '@librechat/client';
import VoicePanel from '~/components/Voice/VoicePanel';
import { VOICE_LABELS as L } from '~/components/Voice/labels';
import { cn } from '~/utils';

/**
 * ChatGPT-style voice entry: a header button that opens the Diya session as a
 * full-screen overlay on top of the chat. The overlay owns its Jotai store
 * (same isolation as the /voice route) and `autoStart` chains the button's
 * user gesture into the mic unlock; unmounting the panel tears the session
 * down, so closing the overlay always ends the call.
 */
export default function HeaderVoiceButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

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
              onClose={() => setOpen(false)}
              className="flex-1"
            />
          </Provider>
        </div>
      )}
    </>
  );
}
