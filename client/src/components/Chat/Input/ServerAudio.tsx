import { useEffect } from 'react';
import { useSetRecoilState } from 'recoil';
import { useParams } from 'react-router-dom';
import { parseTextParts } from 'librechat-data-provider';
import useAutoplayTrigger from '~/hooks/Audio/useAutoplayTrigger';
import useTTSServer from '~/hooks/Audio/useTTSServer';
import store from '~/store';

/**
 * Autoplay driver for the Baanzon server voice. Mirrors BrowserAudio's gate so
 * a run is claimed only after playback actually starts, and cancels when the
 * conversation changes.
 */
export default function ServerAudio({ index = 0 }) {
  const { conversationId: paramId } = useParams();
  const setIsSpeaking = useSetRecoilState(store.globalAudioPlayingFamily(index));
  const setAudioRunId = useSetRecoilState(store.audioRunFamily(index));

  const { shouldPlay, activeRunId, latestMessage } = useAutoplayTrigger(index);
  const { generateSpeech, cancelSpeech } = useTTSServer({ setIsSpeaking });

  useEffect(() => {
    return () => cancelSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramId]);

  useEffect(() => {
    if (!shouldPlay || activeRunId == null || latestMessage == null) {
      return undefined;
    }

    const text =
      Array.isArray(latestMessage.content) && latestMessage.content.length > 0
        ? parseTextParts(latestMessage.content)
        : (latestMessage.text ?? '');
    if (!text) {
      return undefined;
    }

    let cancelled = false;
    void generateSpeech(text).then((started) => {
      if (!cancelled && started) {
        setAudioRunId(activeRunId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shouldPlay, activeRunId, latestMessage, setAudioRunId, generateSpeech]);

  return null;
}
