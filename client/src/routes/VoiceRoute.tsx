import { Provider } from 'jotai';
import { VoicePanel } from '~/components/Voice';

/**
 * Route shell for Voice. With no transport injected the panel falls back to
 * the default WebRTC transport and renders its unsupported state where
 * WebRTC/microphone APIs are missing. The per-mount Jotai store isolates the
 * session's atoms from the rest of the app.
 */
export default function VoiceRoute() {
  return (
    <Provider>
      <VoicePanel />
    </Provider>
  );
}
