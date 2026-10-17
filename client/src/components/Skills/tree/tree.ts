import type { TSkillNode } from 'librechat-data-provider';

/** A node plus its resolved children, in the order the renderer walks them. */
export interface SkillTreeBranch {
  node: TSkillNode;
  depth: number;
  children: SkillTreeBranch[];
}

const RESERVED_NODE_NAME = 'SKILL.MD';

/**
 * Group the flat `GET /api/skills/:id/tree` node list into a renderable tree.
 *
 * Sibling groups keep the server-derived `order` (folders first, then
 * lexicographic). The `name` comparison is only a tiebreaker for a malformed
 * payload where two siblings share an `order`, so the render never depends on
 * array position.
 */
export function buildNodeTree(nodes: TSkillNode[]): SkillTreeBranch[] {
  const byParent = new Map<string | null, TSkillNode[]>();
  const ids = new Set(nodes.map((node) => node._id));

  for (const node of nodes) {
    const parentId = node.parentId != null && ids.has(node.parentId) ? node.parentId : null;
    const siblings = byParent.get(parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      byParent.set(parentId, [node]);
    }
  }

  const walk = (parentId: string | null, depth: number): SkillTreeBranch[] => {
    const siblings = byParent.get(parentId) ?? [];
    return [...siblings]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((node) => ({ node, depth, children: walk(node._id, depth + 1) }));
  };

  return walk(null, 0);
}

/** Depth-first walk in render order, without re-deriving parents from paths. */
export function flattenNodeTree(branches: SkillTreeBranch[]): SkillTreeBranch[] {
  return branches.flatMap((branch) => [branch, ...flattenNodeTree(branch.children)]);
}

/** Every implicit folder path, for the parent-folder pickers. */
export function collectFolderPaths(nodes: TSkillNode[]): string[] {
  return nodes
    .filter((node) => node.type === 'folder')
    .map((node) => node._id)
    .sort((a, b) => a.localeCompare(b));
}

/** Split an editor-entered path into the API contract's `parentId` + `name`. */
export function splitNodePath(path: string): { parentId: string | null; name: string } {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
  const index = trimmed.lastIndexOf('/');
  if (index === -1) {
    return { parentId: null, name: trimmed };
  }
  return { parentId: trimmed.slice(0, index), name: trimmed.slice(index + 1) };
}

/** A single path segment that is not reserved, empty, or a traversal token. */
export function isValidNodeName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('/') &&
    trimmed.toUpperCase() !== RESERVED_NODE_NAME
  );
}

/** True when `candidate` is `ancestor` or lives inside it (used to block self-moves). */
export function isSelfOrDescendantPath(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
}
