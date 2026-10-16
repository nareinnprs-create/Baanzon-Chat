import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { ChartBar, ChartLine, ChartPie, Table2 } from 'lucide-react';
import { Alert, Button, EmptyState, Spinner } from '@librechat/client';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChartKind, DataColumnType, DataRow, DataTable } from './types';
import {
  aggregateByCategory,
  applyFilters,
  describeTable,
  deriveValues,
  formatCell,
  getNumericColumns,
  pickXColumn,
  sortRows,
} from './analysis';
import {
  dataLabChartKindAtom,
  dataLabDerivedSeriesAtom,
  dataLabFiltersAtom,
  dataLabSortAtom,
} from './atoms';
import { DATA_LAB_LABELS, formatDataLabLabel, type DataLabLabelKey } from './labels';
import AnalysisActions from './AnalysisActions';
import { coerceNumber, toText } from './parse';
import LineChart from './charts/LineChart';
import DataLabTable from './DataLabTable';
import BarChart from './charts/BarChart';
import PieChart from './charts/PieChart';
import { cn } from '~/utils';

type RemoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: DataTable }
  | { status: 'error'; error?: string };

export interface DataLabViewProps {
  /** Dataset supplied directly by the host. Keep the reference stable / memoized. */
  dataset?: DataTable | null;
  /** External loading flag; otherwise derived from the injected loader. */
  isLoading?: boolean;
  /** External failure message; otherwise derived from the injected loader. */
  error?: string | null;
  /** Retry handler for external loading/error. */
  onRetry?: () => void;
  /** Injected loader used when `dataset` is not supplied. Must be stable. */
  loadData?: () => Promise<DataTable>;
  title?: string;
  className?: string;
}

const CHART_TABS: Array<{ kind: ChartKind; label: string; Icon: LucideIcon }> = [
  { kind: 'line', label: DATA_LAB_LABELS.chartLine, Icon: ChartLine },
  { kind: 'bar', label: DATA_LAB_LABELS.chartBar, Icon: ChartBar },
  { kind: 'pie', label: DATA_LAB_LABELS.chartPie, Icon: ChartPie },
];

const TYPE_LABELS: Record<DataColumnType, string> = {
  number: DATA_LAB_LABELS.typeNumber,
  date: DATA_LAB_LABELS.typeDate,
  string: DATA_LAB_LABELS.typeString,
};

const STAT_HEADERS: DataLabLabelKey[] = [
  'statColumn',
  'statType',
  'statCount',
  'statMissing',
  'statUnique',
  'statMin',
  'statMax',
  'statMean',
  'statSum',
];

function formatStat(value: number | undefined): string {
  return value === undefined ? '' : formatCell(value, 'number');
}

/**
 * Composes parsing output into the Data Lab: a chart (line/bar/pie), a sortable
 * table and an analysis bar, across explicit loading, empty, success and
 * failure states with a retry affordance. The dataset arrives through props or
 * an injected `loadData`, so the view carries no backend coupling.
 */
export default function DataLabView({
  dataset,
  isLoading,
  error,
  onRetry,
  loadData,
  title,
  className,
}: DataLabViewProps) {
  const [remote, setRemote] = useState<RemoteState>(() => ({
    status: loadData ? 'loading' : 'idle',
  }));
  const loadRef = useRef(loadData);
  const [chartKind, setChartKind] = useAtom(dataLabChartKindAtom);
  const [sort, setSort] = useAtom(dataLabSortAtom);
  const [filters, setFilters] = useAtom(dataLabFiltersAtom);
  const [derived, setDerived] = useAtom(dataLabDerivedSeriesAtom);
  const [describeActive, setDescribeActive] = useState(false);

  useEffect(() => {
    loadRef.current = loadData;
  }, [loadData]);

  const load = useCallback(async () => {
    const loader = loadRef.current;
    if (!loader) {
      return;
    }
    setRemote({ status: 'loading' });
    try {
      const data = await loader();
      setRemote({ status: 'success', data });
    } catch (caught) {
      setRemote({
        status: 'error',
        error: caught instanceof Error ? caught.message : DATA_LAB_LABELS.failureDescription,
      });
    }
  }, []);

  const usingRemote = dataset == null && loadData != null;

  useEffect(() => {
    if (usingRemote) {
      void load();
    }
  }, [usingRemote, load, loadData]);

  const table = dataset ?? (usingRemote && remote.status === 'success' ? remote.data : null);
  const loading = isLoading ?? (usingRemote && remote.status === 'loading');
  const failure = error ?? (usingRemote && remote.status === 'error' ? remote.error : null);

  useEffect(() => {
    if (table) {
      setSort(null);
      setFilters([]);
      setDerived([]);
      setDescribeActive(false);
    }
  }, [table, setSort, setFilters, setDerived]);

  const xColumn = useMemo(() => (table ? pickXColumn(table) : undefined), [table]);
  const numericColumns = useMemo(() => (table ? getNumericColumns(table) : []), [table]);
  const filteredRows = useMemo(
    () => (table ? applyFilters(table.rows, filters) : []),
    [table, filters],
  );
  const rows = useMemo(
    () => (table ? sortRows(filteredRows, sort, table.columns) : []),
    [table, filteredRows, sort],
  );
  const derivedValues = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const item of derived) {
      map.set(item.key, deriveValues(rows, item.column, item.mode));
    }
    return map;
  }, [derived, rows]);

  const series = useMemo(() => {
    const base = numericColumns.slice(0, 3).map((column) => ({
      key: column.key,
      label: column.label,
      value: (row: DataRow) => coerceNumber(row[column.key] ?? null) ?? 0,
    }));
    const extra = derived.map((item) => ({
      key: item.key,
      label: item.label,
      value: (_row: DataRow, index: number) => derivedValues.get(item.key)?.[index] ?? 0,
    }));
    return [...base, ...extra];
  }, [numericColumns, derived, derivedValues]);

  const xAccessor = useCallback(
    (row: DataRow) => (xColumn ? toText(row[xColumn.key] ?? null) : ''),
    [xColumn],
  );

  const pieRows = useMemo<DataRow[]>(() => {
    if (!table || !xColumn || numericColumns.length === 0) {
      return [];
    }
    return aggregateByCategory(rows, xColumn.key, numericColumns[0].key).map((item) => ({
      label: item.label,
      value: item.value,
    }));
  }, [table, rows, xColumn, numericColumns]);

  const stats = useMemo(
    () => (describeActive && table ? describeTable({ columns: table.columns, rows }) : []),
    [describeActive, table, rows],
  );

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    }
    if (usingRemote) {
      void load();
    }
  }, [onRetry, usingRemote, load]);

  const chartTab = CHART_TABS.find((tab) => tab.kind === chartKind) ?? CHART_TABS[0];
  const chartAriaLabel = formatDataLabLabel('chartAria', { 0: chartTab.label });
  const chartDescription = formatDataLabLabel('chartDescription', {
    0: chartTab.label,
    1: rows.length,
  });

  let chart: ReactNode;
  if (chartKind === 'pie') {
    chart = (
      <PieChart
        data={pieRows}
        category={(row) => toText(row.label ?? null)}
        value={(row) => coerceNumber(row.value ?? null) ?? 0}
        ariaLabel={chartAriaLabel}
        description={chartDescription}
        emptyLabel={DATA_LAB_LABELS.chartNoData}
      />
    );
  } else if (chartKind === 'bar') {
    chart = (
      <BarChart
        data={rows}
        x={xAccessor}
        xLabel={xColumn?.label}
        series={series}
        ariaLabel={chartAriaLabel}
        description={chartDescription}
        emptyLabel={DATA_LAB_LABELS.chartNoData}
      />
    );
  } else {
    chart = (
      <LineChart
        data={rows}
        x={xAccessor}
        xLabel={xColumn?.label}
        series={series}
        ariaLabel={chartAriaLabel}
        description={chartDescription}
        emptyLabel={DATA_LAB_LABELS.chartNoData}
      />
    );
  }

  let body: ReactNode;
  if (loading) {
    body = (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-text-secondary"
        data-testid="datalab-status"
      >
        <Spinner className="size-4" aria-hidden="true" />
        {DATA_LAB_LABELS.loading}
      </p>
    );
  } else if (failure) {
    body = (
      <Alert variant="error" data-testid="datalab-status">
        <div className="flex flex-col gap-2">
          <span className="font-medium">{DATA_LAB_LABELS.failureTitle}</span>
          <span>{failure}</span>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
              {DATA_LAB_LABELS.retry}
            </Button>
          </div>
        </div>
      </Alert>
    );
  } else if (!table || table.columns.length === 0 || table.rows.length === 0) {
    body = (
      <EmptyState
        icon={Table2}
        title={DATA_LAB_LABELS.emptyTitle}
        description={DATA_LAB_LABELS.emptyDescription}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <AnalysisActions
          columns={table.columns}
          filters={filters}
          describeActive={describeActive}
          onDescribe={() => setDescribeActive((active) => !active)}
          onAddFilter={(filter) => setFilters((current) => [...current, filter])}
          onRemoveFilter={(index) =>
            setFilters((current) => current.filter((_item, position) => position !== index))
          }
          onClearFilters={() => setFilters([])}
          onDerive={(item) => setDerived((current) => [...current, item])}
        />

        {stats.length > 0 ? (
          <section className="rounded-lg border border-border-light p-4">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">
              {DATA_LAB_LABELS.describeTitle}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border-medium text-xs text-text-secondary">
                  <tr>
                    {STAT_HEADERS.map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="whitespace-nowrap px-2 py-2 font-medium"
                      >
                        {formatDataLabLabel(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {stats.map((stat) => (
                    <tr key={stat.key}>
                      <td className="whitespace-nowrap px-2 py-2 text-text-primary">
                        {stat.label}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-text-secondary">
                        {TYPE_LABELS[stat.type]}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{stat.count}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{stat.missing}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{stat.unique}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatStat(stat.min)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatStat(stat.max)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatStat(stat.mean)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatStat(stat.sum)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-border-light p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              {DATA_LAB_LABELS.chartSectionTitle}
            </h3>
            <div
              role="group"
              aria-label={DATA_LAB_LABELS.chartSectionTitle}
              className="inline-flex rounded-lg border border-border-light p-0.5"
            >
              {CHART_TABS.map((tab) => (
                <Button
                  key={tab.kind}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={chartKind === tab.kind}
                  className={cn('h-8 gap-1.5', chartKind === tab.kind && 'bg-surface-active-alt')}
                  onClick={() => setChartKind(tab.kind)}
                >
                  <tab.Icon className="size-4" aria-hidden="true" />
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>
          {chart}
        </section>

        <section className="rounded-lg border border-border-light p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">
            {DATA_LAB_LABELS.tableSectionTitle}
          </h3>
          <DataLabTable
            table={{ columns: table.columns, rows }}
            sort={sort}
            onSortChange={setSort}
          />
        </section>
      </div>
    );
  }

  return (
    <section className={cn('flex h-full w-full flex-col gap-4 p-4', className)}>
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">
          {title ?? DATA_LAB_LABELS.title}
        </h2>
        {table ? (
          <p className="text-xs text-text-secondary">
            {formatDataLabLabel('summaryRows', {
              0: table.rows.length,
              1: table.columns.length,
            })}
          </p>
        ) : null}
      </header>
      {body}
    </section>
  );
}
