import { useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { useAtomValue, useStore } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, buildTree } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { GitBranch } from 'lucide-react';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';
import { useParams } from 'react-router-dom';
import { siblingIdxFamily, siblingIndexesAtom, siblingKey } from '~/components/Chat/Messages/Thread/state';

/**
 * X2 — visible conversation branch tree. Reads the same message tree the
 * thread renders (react-query cache), highlights the active branch (per-parent
 * sibling selections from the thread's Jotai state), and switches branches by
 * writing those same atoms — the exact mechanism the hover arrows use, so no
 * server call is involved.
 */

interface TreeRow {
  message: TMessage;
  children: TreeRow[];
  /** Position among its siblings, ascending (0 = oldest). */
  position: number;
  count: number;
  parent: TreeRow | null;
}

function toRows(nodes: TMessage[] | undefined | null, parent: TreeRow | null = null): TreeRow[] {
  if (!nodes?.length) {
    return [];
  }
  return nodes.map((message, position) => {
    const row: TreeRow = { message, position, count: nodes.length, parent, children: [] };
    row.children = toRows(message.children, row);
    return row;
  });
}

function snippet(message: TMessage): string {
  const text = Array.isArray(message.content)
    ? message.content
        .map((part) => (typeof part === 'object' && part != null && 'text' in part ? String((part as { text?: { value?: string } }).text?.value ?? '') : ''))
        .join(' ')
    : String(message.text ?? '');
  return text.replace(/<[^>]*>/g, ' ').trim().slice(0, 64) || '…';
}

export default function BranchTree({ readOnly = false }: { readOnly?: boolean }) {
  const localize = useLocalize();
  const { conversationId: routeId } = useParams();
  const queryClient = useQueryClient();
  const store = useStore();
  const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, routeId ?? '']);

  /** The cache holds a flat array; buildTree nests children for the walk. */
  const rows = useMemo(() => toRows(buildTree({ messages: messages ?? null })), [messages]);
  /** Every parent whose children branch — the only keys that matter. */
  const branchKeys = useMemo(
    () =>
      rows.length
        ? (function collect(nodes: TreeRow[], acc: string[]) {
            for (const node of nodes) {
              if (node.count > 1) {
                acc.push(siblingKey(node.message.parentMessageId ?? undefined));
              }
              collect(node.children, acc);
            }
            return acc;
          })(rows, [])
        : [],
    [rows],
  );
  const selections = useAtomValue(
    useMemo(() => siblingIndexesAtom(branchKeys), [branchKeys.join('|')]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const activeIds = useMemo(() => {
    const active = new Set<string>();
    /** One walk across the whole level: root siblings share the null-parent
     *  key, so the level's single selection decides which root is active. */
    const walk = (nodes: TreeRow[]) => {
      if (!nodes.length) {
        return;
      }
      const key = siblingKey(nodes[0].message.parentMessageId ?? undefined);
      const reversed = selections[key] ?? 0;
      const index = nodes.length - reversed - 1;
      const activeNode = nodes[index] ?? nodes[nodes.length - 1];
      if (!activeNode) {
        return;
      }
      active.add(activeNode.message.messageId ?? '');
      walk(activeNode.children);
    };
    walk(rows);
    return active;
  }, [rows, selections]);

  const hasBranches = useMemo(() => {
    let found = false;
    const walk = (nodes: TreeRow[]) => {
      nodes.forEach((node) => {
        if (node.count > 1) {
          found = true;
        }
        walk(node.children);
      });
    };
    walk(rows);
    return found;
  }, [rows]);

  if (readOnly || !hasBranches) {
    return null;
  }

  const switchTo = (node: TreeRow) => {
    /** Branch jump: write the reversed sibling index for every level from this
     *  node up to its root — the same atoms the hover arrows write — so the
     *  visible thread routes through this node even if its root was inactive. */
    let current: TreeRow | null = node;
    while (current) {
      const key = siblingKey(current.message.parentMessageId ?? undefined);
      store.set(siblingIdxFamily(key), current.count - current.position - 1);
      current = current.parent;
    }
  };

  const renderRows = (nodes: TreeRow[], depth = 0) =>
    nodes.map((node) => {
      const isActivePath = activeIds.has(node.message.messageId ?? '');
      return (
        <div key={node.message.messageId} role="none">
          <button
            role="treeitem"
            aria-selected={isActivePath}
            aria-level={depth + 1}
            onClick={() => switchTo(node)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
              'hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
              isActivePath
                ? 'bg-surface-secondary font-medium text-text-primary'
                : 'text-text-secondary',
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 flex-shrink-0 rounded-full',
                node.message.isCreatedByUser ? 'bg-border-heavy' : 'bg-primary',
                isActivePath ? 'opacity-100' : 'opacity-40',
              )}
            />
            <span className="flex-shrink-0 text-xs text-text-secondary">
              {node.message.isCreatedByUser ? localize('com_ui_you') : 'AI'}
            </span>
            <span className="truncate">{snippet(node.message)}</span>
          </button>
          {renderRows(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <Ariakit.MenuProvider placement="bottom-start">
      <Ariakit.MenuButton
        aria-label={localize('com_ui_branch_tree')}
        className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
      >
        <GitBranch className="size-4" aria-hidden="true" />
      </Ariakit.MenuButton>
      <Ariakit.Menu
        gutter={8}
        className="z-50 max-h-[60vh] w-80 overflow-y-auto rounded-xl border border-border-medium bg-surface-primary p-1 shadow-lg"
        aria-label={localize('com_ui_branch_tree')}
      >
        <div role="tree" aria-label={localize('com_ui_branch_tree')}>
          {renderRows(rows)}
        </div>
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}
