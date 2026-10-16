import { Fragment, memo } from 'react';
import type { TSkillNode } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import type { SkillTreeBranch } from './tree';
import SkillTreeNodeRow from './SkillTreeNodeRow';

interface SkillTreeViewProps {
  branches: SkillTreeBranch[];
  selectedId: string | null;
  expandedIds: Set<string>;
  canEdit: boolean;
  onActivate: (node: TSkillNode) => void;
  onToggle: (nodeId: string) => void;
  onRename: (node: TSkillNode) => void;
  onDelete: (node: TSkillNode) => void;
}

/**
 * Renders the server-ordered node tree. Folders collapse/expand; files select
 * into the editor pane. Purely presentational — data comes from the workspace,
 * which owns the query and the selection/expansion state.
 */
function SkillTreeView({
  branches,
  selectedId,
  expandedIds,
  canEdit,
  onActivate,
  onToggle,
  onRename,
  onDelete,
}: SkillTreeViewProps) {
  const localize = useLocalize();

  const renderBranch = (branch: SkillTreeBranch) => {
    const { node, children } = branch;
    const isFolder = node.type === 'folder';
    const isExpanded = isFolder && expandedIds.has(node._id);

    return (
      <Fragment key={node._id}>
        <SkillTreeNodeRow
          branch={branch}
          isSelected={selectedId === node._id}
          isExpanded={isExpanded}
          canEdit={canEdit}
          onActivate={onActivate}
          onToggle={onToggle}
          onRename={onRename}
          onDelete={onDelete}
        />
        {isExpanded && children.length > 0 && <div role="group">{children.map(renderBranch)}</div>}
      </Fragment>
    );
  };

  return (
    <div
      role="tree"
      aria-label={localize('com_ui_files')}
      className="flex flex-col gap-0.5 px-1 py-1"
    >
      {branches.map(renderBranch)}
    </div>
  );
}

export default memo(SkillTreeView);
