import { useCallback, useEffect, useRef } from 'react';
import { useToastContext } from '@librechat/client';
import { Mic } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import type { RefObject } from 'react';
import useScribeRecording from './useScribeRecording';
import { DIYA_OPEN_EVENT } from '~/components/Voice/events';
import { applyTranscript, type InsertionSlot } from './speech';
import { useChatFormContext } from '~/Providers';
import { useAuthToken } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
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
 * Dictation mic: records on the device and transcribes on our server, the same
 * path Diya uses. Works wherever capture works (Chromium, Firefox, iOS PWA),
 * detects the spoken language, and reports failures instead of going silent.
 * Text lands at the caret where dictation started.
 */
function VoiceMic({
  textAreaRef,
  isSubmitting,
  conversationId,
}: {
  textAreaRef: RefObject<HTMLTextAreaElement>;
  isSubmitting?: boolean;
  conversationId?: string | null;
}) {
  const localize = useLocalize();
  const methods = useChatFormContext();
  const token = useAuthToken();
  const { showToast } = useToastContext();
  const slotRef = useRef<InsertionSlot | null>(null);

  const onText = useCallback(
    (text: string) => {
      const dictation = text.trim();
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

  const onError = useCallback(
    (key: TranslationKeys) => {
      showToast({ message: localize(key), status: 'error' });
    },
    [localize, showToast],
  );

  const scribe = useScribeRecording({ token, onText, onError });
  const recording = scribe.state === 'recording';
  const busy = scribe.state === 'transcribing';

  const toggle = useCallback(() => {
    if (recording) {
      scribe.toggle();
      return;
    }
    // A new take starts a new insertion slot at the current caret.
    slotRef.current = null;
    scribe.toggle();
  }, [recording, scribe]);

  // Sending the message ends dictation: the take is dropped, not appended to
  // the next message.
  useEffect(() => {
    if (isSubmitting) {
      scribe.cancel();
    }
  }, [isSubmitting, scribe]);

  // Diya is taking the microphone; drop the take rather than fight for it.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handle = () => scribe.cancel();
    window.addEventListener(DIYA_OPEN_EVENT, handle);
    return () => window.removeEventListener(DIYA_OPEN_EVENT, handle);
  }, [scribe]);

  // Switching conversations must not carry dictation into the new thread.
  useEffect(() => {
    scribe.cancel();
    slotRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on thread change
  }, [conversationId]);

  if (!scribe.supported) {
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

  const label = busy
    ? localize('com_ui_voice_transcribing')
    : recording
      ? localize('com_ui_voice_listening')
      : localize('com_ui_voice_input');

  return (
    <TooltipButton
      label={label}
      testId="voice-mic-button"
      onClick={toggle}
      disabled={busy}
      pressed={recording}
      ring={recording}
      status={
        recording || busy ? (
          <span role="status" aria-live="polite" className="sr-only">
            {label}
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
function VoiceControls({
  textAreaRef,
  isSubmitting,
  conversationId,
}: {
  textAreaRef: RefObject<HTMLTextAreaElement>;
  isSubmitting?: boolean;
  conversationId?: string | null;
}) {
  return (
    <VoiceMic
      textAreaRef={textAreaRef}
      isSubmitting={isSubmitting}
      conversationId={conversationId}
    />
  );
}

export default VoiceControls;
