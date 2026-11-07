import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useAtom } from 'jotai';
import { Mic, Volume2, VolumeX } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import { useLocalize } from '~/hooks';
import { useChatFormContext } from '~/Providers';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { getLatestText, cn } from '~/utils';
import { voiceActivityAtom } from './atoms';
import useSpeechRecognition, { isSpeechRecognitionSupported } from './useSpeechRecognition';
import useSpeechSynthesis from './useSpeechSynthesis';
import { applyTranscript, type InsertionSlot } from './speech';

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
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-current opacity-60 animate-ping motion-reduce:animate-none"
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
        slotRef.current == null ? textAreaRef.current?.selectionStart ?? undefined : undefined;
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

/**
 * Read-aloud: speaks the latest assistant message of the active branch via
 * speech synthesis; a second click stops mid-utterance.
 */
function ReadAloud({ index }: { index: number }) {
  const localize = useLocalize();
  const latestMessage = useLatestMessage(index);
  const [activity, setActivity] = useAtom(voiceActivityAtom);
  const speaking = activity === 'speaking';

  const text =
    latestMessage && latestMessage.isCreatedByUser !== true ? getLatestText(latestMessage) : '';

  const handleEnd = useCallback(
    (stillSpeaking: boolean) => {
      if (!stillSpeaking) {
        setActivity((prev) => (prev === 'speaking' ? 'idle' : prev));
      }
    },
    [setActivity],
  );
  const { speak, cancel } = useSpeechSynthesis(handleEnd);

  const toggle = useCallback(() => {
    if (speaking) {
      cancel();
      return;
    }
    setActivity('speaking');
    if (!speak(text)) {
      setActivity('idle');
    }
  }, [cancel, speak, speaking, setActivity, text]);

  // Yield to the mic: dictation must not transcribe the loudspeaker.
  useEffect(() => {
    if (activity === 'listening') {
      cancel();
    }
  }, [activity, cancel]);

  return (
    <TooltipButton
      label={speaking ? localize('com_ui_voice_stop') : localize('com_ui_voice_read')}
      testId="voice-read-button"
      onClick={toggle}
      disabled={!text && !speaking}
      pressed={speaking}
    >
      {speaking ? (
        <VolumeX className="size-4" aria-hidden="true" />
      ) : (
        <Volume2 className="size-4" aria-hidden="true" />
      )}
    </TooltipButton>
  );
}

/** Voice in/out for the composer: dictation mic + read-aloud of the latest reply. */
function VoiceControls({ index, textAreaRef }: { index: number; textAreaRef: RefObject<HTMLTextAreaElement> }) {
  return (
    <>
      <VoiceMic textAreaRef={textAreaRef} />
      <ReadAloud index={index} />
    </>
  );
}

export default VoiceControls;
