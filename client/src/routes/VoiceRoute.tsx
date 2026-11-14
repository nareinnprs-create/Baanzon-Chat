import { Provider } from 'jotai';
import { VoicePanel } from '~/components/Voice';

/**
 * Route shell for Voice. The Diya Orb session runs on Web Speech APIs and
 * renders its unsupported state where speech recognition/synthesis or the
 * microphone are missing. The per-mount Jotai store isolates the session's
 * atoms from the rest of the app.
 */
export default function VoiceRoute() {
  return (
    <Provider>
      <VoicePanel />
    </Provider>
  );
}
