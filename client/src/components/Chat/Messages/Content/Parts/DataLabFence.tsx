import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChartKind, DataRow, SortState } from '~/components/DataLab';
import { BarChart, DataLabTable, LineChart, PieChart, parseTable } from '~/components/DataLab';
import CodeBlock from '~/components/Messages/Content/CodeBlock';
import MarkdownErrorBoundary from '../MarkdownErrorBoundary';

/**
 * A4 generative UI: `chart` and `table` code fences render DataLab primitives
 * inline in the message. The contract is plain JSON/CSV a model can emit:
 *
 * ```chart
 * {"kind": "bar", "title": "Revenue", "data": [{"label": "Q1", "value": 12}]}
 * ```
 *
 * ```table
 * name,score
 * alpha,9
 * ```
 *
 * Every numeric key besides `label` becomes a series (bar/line) so a second
 * key on the rows plots for free; pie uses the `value` key when present. A
 * fence that does not parse (including a half-streamed one) falls back to the
 * ordinary code block for that language — the raw text is never lost, and the
 * completed message swaps to the rendered primitive.
 */

const ARIA_LABEL_FALLBACK = 'Chart';

interface ChartSpec {
  kind?: string;
  title?: string;
  data: Array<Record<string, unknown>>;
}

function parseChartSpec(text: string): ChartSpec | null {
  let spec: unknown;
  try {
    spec = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof spec !== 'object' || spec === null || !Array.isArray((spec as ChartSpec).data)) {
    return null;
  }
  const data = (spec as ChartSpec).data;
  if (data.length === 0 || typeof data[0] !== 'object' || data[0] === null) {
    return null;
  }
  return spec as ChartSpec;
}

function prettify(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function buildChart(spec: ChartSpec): ReactNode {
  const rows: DataRow[] = spec.data.map((entry) => {
    const row: DataRow = {};
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === 'number') {
        row[key] = value;
      } else if (value == null) {
        row[key] = '';
      } else {
        row[key] = String(value);
      }
    }
    return row;
  });
  const valueKeys = Object.keys(spec.data[0]).filter(
    (key) => key !== 'label' && typeof spec.data[0][key] === 'number',
  );
  if (valueKeys.length === 0) {
    return null;
  }
  const kind: ChartKind = spec.kind === 'line' || spec.kind === 'pie' ? spec.kind : 'bar';
  const title = typeof spec.title === 'string' ? spec.title : undefined;
  const ariaLabel = title ?? ARIA_LABEL_FALLBACK;
  const labelAccessor = (row: DataRow) => String(row.label ?? '');

  if (kind === 'pie') {
    const valueKey = valueKeys.includes('value') ? 'value' : valueKeys[0];
    return (
      <PieChart
        data={rows}
        category={labelAccessor}
        value={(row) => Number(row[valueKey])}
        ariaLabel={ariaLabel}
        title={title}
      />
    );
  }

  const series = valueKeys.map((key) => ({
    key,
    label: prettify(key),
    value: (row: DataRow) => Number(row[key]),
  }));
  const Chart = kind === 'line' ? LineChart : BarChart;
  return (
    <Chart data={rows} x={labelAccessor} series={series} ariaLabel={ariaLabel} title={title} />
  );
}

function ChartFence({ content, fallback }: { content: string; fallback: ReactNode }) {
  const parsed = useMemo(() => parseChartSpec(content), [content]);
  const node = useMemo(() => (parsed ? buildChart(parsed) : null), [parsed]);
  if (node === null) {
    return <>{fallback}</>;
  }
  return (
    <div className="my-2 w-full">
      <MarkdownErrorBoundary content={content}>{node}</MarkdownErrorBoundary>
    </div>
  );
}

function TableFence({ content, fallback }: { content: string; fallback: ReactNode }) {
  const [sort, setSort] = useState<SortState | null>(null);
  const table = useMemo(() => {
    try {
      const parsed = parseTable(content);
      return parsed.rows.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  }, [content]);
  if (!table) {
    return <>{fallback}</>;
  }
  return (
    <div className="my-2 w-full overflow-x-auto">
      <DataLabTable table={table} sort={sort} onSortChange={setSort} />
    </div>
  );
}

export default function DataLabFence({
  lang,
  content,
  codeChildren,
  allowExecution,
  blockIndex,
  fallback,
}: {
  lang?: string;
  content: string;
  codeChildren: ReactNode;
  allowExecution: boolean;
  blockIndex?: number;
  fallback?: ReactNode;
}) {
  const codeFallback = fallback ?? (
    <CodeBlock
      lang={lang ?? 'text'}
      codeChildren={codeChildren}
      blockIndex={blockIndex}
      allowExecution={allowExecution}
    />
  );
  if (lang === 'chart') {
    return <ChartFence content={content} fallback={codeFallback} />;
  }
  if (lang === 'table') {
    return <TableFence content={content} fallback={codeFallback} />;
  }
  return codeFallback;
}
