import { useMemo } from 'react';
import { EmptyState } from '@librechat/client';
import { ArrowDown, ArrowUp, ArrowUpDown, Table2 } from 'lucide-react';
import type { DataTable, SortState } from './types';
import { DATA_LAB_LABELS, formatDataLabLabel } from './labels';
import { formatCell, sortRows } from './analysis';
import { cn } from '~/utils';

interface DataLabTableProps {
  table: DataTable;
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  caption?: string;
  emptyLabel?: string;
  className?: string;
}

function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) {
    return { key, direction: 'asc' };
  }
  if (current.direction === 'asc') {
    return { key, direction: 'desc' };
  }
  return null;
}

function ariaSortFor(sort: SortState | null, key: string): 'ascending' | 'descending' | 'none' {
  if (!sort || sort.key !== key) {
    return 'none';
  }
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function SortIndicator({ sort, columnKey }: { sort: SortState | null; columnKey: string }) {
  if (sort?.key !== columnKey) {
    return <ArrowUpDown className="size-3.5 text-text-muted opacity-60" aria-hidden="true" />;
  }
  if (sort.direction === 'asc') {
    return <ArrowUp className="size-3.5" aria-hidden="true" />;
  }
  return <ArrowDown className="size-3.5" aria-hidden="true" />;
}

/**
 * Accessible, sortable table for a {@link DataTable}. The sort is controlled by
 * the parent through `sort`/`onSortChange`; the table applies the ordering so a
 * bare render is already sorted.
 */
export default function DataLabTable({
  table,
  sort,
  onSortChange,
  caption,
  emptyLabel,
  className,
}: DataLabTableProps) {
  const rows = useMemo(() => sortRows(table.rows, sort, table.columns), [table, sort]);
  const message = emptyLabel ?? DATA_LAB_LABELS.tableEmpty;

  if (table.columns.length === 0 || rows.length === 0) {
    return <EmptyState icon={Table2} title={message} className={className} />;
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption ?? DATA_LAB_LABELS.tableCaption}</caption>
        <thead className="border-b border-border-medium text-xs text-text-secondary">
          <tr>
            {table.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={ariaSortFor(sort, column.key)}
                className="whitespace-nowrap px-2 py-2 font-medium"
              >
                <button
                  type="button"
                  onClick={() => onSortChange(nextSort(sort, column.key))}
                  aria-label={formatDataLabLabel('sortBy', { 0: column.label })}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring-primary"
                >
                  <span>{column.label}</span>
                  <SortIndicator sort={sort} columnKey={column.key} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-surface-hover">
              {table.columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'whitespace-nowrap px-2 py-2',
                    column.type === 'number' ? 'text-right tabular-nums' : 'text-text-primary',
                  )}
                >
                  {formatCell(row[column.key] ?? null, column.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
