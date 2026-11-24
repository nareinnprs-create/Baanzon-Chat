import { Provider } from 'jotai';
import useDiyaChatTurn from '~/components/Voice/useDiyaChatTurn';
import { VoicePanel } from '~/components/Voice';

/**
 * Route shell for Voice.
 *
 * The session rides the real chat pipeline (same as the header overlay), so a
 * spoken exchange on this page is recorded in the conversation instead of
 * disappearing when the page closes. The per-mount Jotai store isolates the
 * session's atoms from the rest of the app.
 */
export default function VoiceRoute() {
  const chatTurn = useDiyaChatTurn();
  return (
    <Provider>
      <VoicePanel turn={chatTurn} />
    </Provider>
  );
}
