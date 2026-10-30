import { memo } from 'react';
import { FilePlus, RefreshCw, Upload } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface TreeToolbarProps {
  canEdit: boolean;
  isRefreshing: boolean;
  onNewFile: () => void;
  onUpload: () => void;
  onRefresh: () => void;
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded-md bg-transparent p-1 text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function TreeToolbar({ canEdit, isRefreshing, onNewFile, onUpload, onRefresh }: TreeToolbarProps) {
  const localize = useLocalize();

  return (
    <div
      className="flex items-center gap-0.5 px-1.5 py-1"
      role="toolbar"
      aria-label={localize('com_ui_files')}
    >
      <ToolbarButton
        label={localize('com_ui_skill_new_file')}
        disabled={!canEdit}
        onClick={onNewFile}
      >
        <FilePlus className="size-3.5" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={localize('com_ui_skill_upload_file')}
        disabled={!canEdit}
        onClick={onUpload}
      >
        <Upload className="size-3.5" aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton label={localize('com_ui_refresh')} onClick={onRefresh}>
        <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} aria-hidden="true" />
      </ToolbarButton>
    </div>
  );
}

export default memo(TreeToolbar);
