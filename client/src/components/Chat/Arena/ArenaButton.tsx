import { useAtom } from 'jotai';
import { GitCompare } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import { TooltipAnchor } from '@librechat/client';
import type { TStartupConfig } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { arenaOpenAtom } from './atoms';
import ArenaPanel from './ArenaPanel';

/** Header entry point for the Model Arena: opens the lane-2 / vote panel over
 *  the existing addedConvo dual-submission wave. Esc and outside clicks close
 *  it through the Ariakit store; the open state stays in the feature's atom. */
export default function ArenaButton({
  startupConfig,
}: {
  startupConfig: TStartupConfig | undefined;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useAtom(arenaOpenAtom);
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-start', open, setOpen });

  if (startupConfig == null) {
    return null;
  }

  return (
    <>
      <TooltipAnchor
        description={localize('com_ui_arena')}
        render={
          <Ariakit.PopoverDisclosure
            store={popover}
            type="button"
            data-testid="arena-button"
            aria-label={localize('com_ui_arena')}
            className="inline-flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-border-light bg-presentation text-text-primary transition-colors ease-in-out hover:bg-surface-tertiary aria-expanded:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          >
            <GitCompare className="icon-sm" aria-hidden="true" />
          </Ariakit.PopoverDisclosure>
        }
      />
      <Ariakit.Popover
        store={popover}
        gutter={8}
        portal
        unmountOnHide
        aria-label={localize('com_ui_arena_pick')}
        className="z-50 flex flex-col gap-3 rounded-lg border border-border-medium bg-surface-primary p-3 shadow-lg"
      >
        <ArenaPanel startupConfig={startupConfig} />
      </Ariakit.Popover>
    </>
  );
}
