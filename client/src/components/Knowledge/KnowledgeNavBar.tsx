import { Plus } from 'lucide-react';
import { Button, useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useLocalize } from '~/hooks';

type KnowledgeNavBarProps = {
  onCreate: () => void;
  /** The 503 kill switch hides the create affordance with the rest of the feature. */
  isDisabled?: boolean;
};

export default function KnowledgeNavBar({ onCreate, isDisabled = false }: KnowledgeNavBarProps) {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  return (
    <header className="sticky top-0 z-10 border-b border-border-light bg-presentation">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3 md:px-6 md:py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {isSmallScreen ? <OpenSidebar className="size-9 shrink-0" /> : null}
            <h1 className="truncate text-balance text-lg font-semibold tracking-tight text-text-primary md:text-xl">
              {localize('com_ui_knowledge')}
            </h1>
          </div>
          {!isDisabled ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onCreate}
              className="shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {localize('com_ui_knowledge_create_collection')}
            </Button>
          ) : null}
        </div>
        <p className="text-pretty text-sm text-text-secondary">
          {localize('com_ui_knowledge_description')}
        </p>
      </div>
    </header>
  );
}
