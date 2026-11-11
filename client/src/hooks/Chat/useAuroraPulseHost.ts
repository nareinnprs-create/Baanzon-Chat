import { useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';
import { useSetAuroraPulse } from '~/components/Aurora/atoms';

/**
 * Maps the chat generation lifecycle onto the Baanzon Intelligence Pulse
 * (blueprint 63.9). The pulse must stay truthful: submission turns it to
 * `thinking`, a completed run shows `completed` briefly, and aborts, errors
 * and idle mounts leave it honestly still. Streaming detail (searching /
 * reading / creating) is wired when the transport exposes those signals.
 */
export function useAuroraPulseHost(index: number): void {
  const setPulse = useSetAuroraPulse();
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const runEnd = useRecoilValue(store.runEndByIndex(index));

  useEffect(() => {
    if (isSubmitting) {
      setPulse('thinking');
      return;
    }
    if (runEnd != null) {
      if (runEnd.outcome === 'completed') {
        setPulse('completed');
        const timer = setTimeout(() => setPulse('idle'), 3000);
        return () => clearTimeout(timer);
      }
      setPulse('idle');
    }
  }, [isSubmitting, runEnd, setPulse]);
}
