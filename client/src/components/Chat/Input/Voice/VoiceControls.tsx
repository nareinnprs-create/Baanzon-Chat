import { useCallback, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { Mic } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import type { RefObject } from 'react';
import useSpeechRecognition, { isSpeechRecognitionSupported } from './useSpeechRecognition';
import { applyTranscript, type InsertionSlot } from './speech';
import { useChatFormContext } from '~/Providers';
import { voiceActivityAtom } from './atoms';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const controlClasses = cn(
  'flex size-theme-control items-center justify-center rounded-theme-control-round border border-border-light',
  'text-text-secondary transition-colors duration-theme-normal',
  'hover:bg-surface-composer-hover hover:text-text-primary',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
  'animate-in fade-in duration-200 motion-reduce:transition-none motion-reduce:animate-none',
);

function TooltipButton({
  label,
  testId,
  onClick,
  disabled,
  pressed,
  children,
  ring,
  status,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
  /** Pulsing "active" ring; static under prefers-reduced-motion. */
  ring?: boolean;
  /** Screen-reader announcements (aria-live), e.g. the listening state. */
  status?: React.ReactNode;
}) {
  return (
    <Ariakit.TooltipProvider placement="top" timeout={300}>
      <Ariakit.TooltipAnchor
        render={
          <span className="relative flex">
            {ring && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 animate-ping rounded-full border-2 border-current opacity-60 motion-reduce:animate-none"
              />
            )}
            <button
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={pressed}
              data-testid={testId}
              onClick={onClick}
              disabled={disabled}
              className={controlClasses}
            >
              {children}
            </button>
          </span>
        }
      />
      <Ariakit.Tooltip className="z-50 rounded-lg bg-surface-tertiary px-2 py-1 text-xs text-text-primary shadow-lg">
        {label}
      </Ariakit.Tooltip>
      {status}
    </Ariakit.TooltipProvider>
  );
}

/**
 * Dictation mic: Web Speech recognition transcribed straight into the
 * composer. Every recognition event rewrites the range this session owns
 * (see `applyTranscript`), so interim results replace themselves and finals
 * land in one growing block, at the caret where dictation started.
 */
function VoiceMic({ textAreaRef }: { textAreaRef: RefObject<HTMLTextAreaElement> }) {
  const localize = useLocalize();
  const methods = useChatFormContext();
  const [activity, setActivity] = useAtom(voiceActivityAtom);
  const slotRef = useRef<InsertionSlot | null>(null);
  const listening = activity === 'listening';
  const supported = isSpeechRecognitionSupported();

  const onResult = useCallback(
    (final: string, interim: string) => {
      const dictation = interim ? (final ? `${final} ` : '') + interim : final;
      if (!dictation) {
        return;
      }
      const current = methods.getValues('text') ?? '';
      const caret =
        slotRef.current == null ? (textAreaRef.current?.selectionStart ?? undefined) : undefined;
      const next = applyTranscript(current, dictation, slotRef.current, caret);
      slotRef.current = next.slot;
      methods.setValue('text', next.text, { shouldValidate: true });
      const textarea = textAreaRef.current;
      if (textarea) {
        textarea.selectionStart = textarea.selectionEnd = next.cursor;
      }
    },
    [methods, textAreaRef],
  );

  const { start, stop } = useSpeechRecognition(onResult);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      // Only clear our own state; the read-aloud may have claimed the slot.
      setActivity((prev) => (prev === 'listening' ? 'idle' : prev));
    } else {
      slotRef.current = null;
      setActivity('listening');
      start();
    }
  }, [listening, setActivity, start, stop]);

  // The mic yields to read-aloud: stop the engine without touching the atom,
  // which now belongs to the speaker.
  useEffect(() => {
    if (activity === 'speaking') {
      stop();
    }
  }, [activity, stop]);

  if (!supported) {
    return (
      <TooltipButton
        label={localize('com_ui_voice_unsupported')}
        testId="voice-mic-button"
        onClick={() => undefined}
        disabled
      >
        <Mic className="size-4" aria-hidden="true" />
      </TooltipButton>
    );
  }

  return (
    <TooltipButton
      label={listening ? localize('com_ui_voice_listening') : localize('com_ui_voice_input')}
      testId="voice-mic-button"
      onClick={toggle}
      pressed={listening}
      ring={listening}
      status={
        listening ? (
          <span role="status" aria-live="polite" className="sr-only">
            {localize('com_ui_voice_listening')}
          </span>
        ) : null
      }
    >
      <Mic className="size-4" aria-hidden="true" />
    </TooltipButton>
  );
}

/** Voice in for the composer: the dictation mic. Read-aloud lives on each
 *  assistant message (message-level actions), matching ChatGPT. */
function VoiceControls({ textAreaRef }: { textAreaRef: RefObject<HTMLTextAreaElement> }) {
  return <VoiceMic textAreaRef={textAreaRef} />;
}

export default VoiceControls;
