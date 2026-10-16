import { memo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { DropdownPopup } from '@librechat/client';
import type { MenuItemProps } from '@librechat/client';
import type { TSkillNode } from 'librechat-data-provider';
import type { SkillTreeBranch } from './tree';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const BODY_NODE_ID = 'SKILL.md';
const INDENT_PX = 14;

function NodeIcon({ isFolder, isExpanded }: { isFolder: boolean; isExpanded: boolean }) {
  if (!isFolder) {
    return <FileText className="size-3.5 shrink-0" aria-hidden="true" />;
  }
  return isExpanded ? (
    <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
  ) : (
    <Folder className="size-3.5 shrink-0" aria-hidden="true" />
  );
}

interface SkillTreeNodeRowProps {
  branch: SkillTreeBranch;
  isSelected: boolean;
  isExpanded: boolean;
  canEdit: boolean;
  onActivate: (node: TSkillNode) => void;
  onToggle: (nodeId: string) => void;
  onRename: (node: TSkillNode) => void;
  onDelete: (node: TSkillNode) => void;
}

function SkillTreeNodeRow({
  branch,
  isSelected,
  isExpanded,
  canEdit,
  onActivate,
  onToggle,
  onRename,
  onDelete,
}: SkillTreeNodeRowProps) {
  const localize = useLocalize();
  const [menuOpen, setMenuOpen] = useState(false);
  const { node, depth } = branch;
  const isFolder = node.type === 'folder';
  const isBody = node._id === BODY_NODE_ID;

  const items: MenuItemProps[] = [
    {
      label: localize('com_ui_rename'),
      icon: <Pencil className="size-4" aria-hidden="true" />,
      onClick: () => onRename(node),
    },
    {
      label: localize('com_ui_delete'),
      icon: <Trash2 className="size-4" aria-hidden="true" />,
      className: 'text-text-destructive',
      onClick: () => onDelete(node),
    },
  ];

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isFolder ? undefined : isSelected}
      aria-expanded={isFolder ? isExpanded : undefined}
      className={cn(
        'group flex items-center gap-0.5 rounded-lg pr-1',
        isSelected && !isFolder ? 'bg-surface-active' : 'hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        onClick={() => (isFolder ? onToggle(node._id) : onActivate(node))}
        style={{ paddingLeft: `${depth * INDENT_PX + 6}px` }}
        className={cn(
          'flex min-w-0 flex-1 select-none items-center gap-1.5 rounded-lg py-1.5 text-left text-sm',
          isSelected && !isFolder
            ? 'font-medium text-text-primary'
            : 'text-text-secondary hover:text-text-primary',
        )}
      >
        {isFolder && (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform duration-150',
              isExpanded && 'rotate-90',
            )}
            aria-hidden="true"
          />
        )}
        <NodeIcon isFolder={isFolder} isExpanded={isExpanded} />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>

      {canEdit && !isBody && (
        <DropdownPopup
          menuId={`skill-node-menu-${node._id}`}
          portal={true}
          gutter={4}
          isOpen={menuOpen}
          setIsOpen={setMenuOpen}
          items={items}
          trigger={
            <Ariakit.MenuButton
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary opacity-0 transition-opacity hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring-primary group-hover:opacity-100"
              aria-label={`${localize('com_ui_edit')} ${node.name}`}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Ariakit.MenuButton>
          }
        />
      )}
    </div>
  );
}

export default memo(SkillTreeNodeRow);
