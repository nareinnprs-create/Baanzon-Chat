/**
 * Data Lab — a self-contained "explore a tabular dataset" feature: hand-rolled
 * SVG charts (line/bar/pie), a sortable accessible table, and an analysis
 * action bar, with loading/empty/success/failure + retry states.
 *
 * ## Mounting (for the integrator)
 *
 * The view is backend-agnostic: hand it a parsed `DataTable`, or inject a
 * loader that resolves one. The `dataset` reference must be stable (memoize it)
 * because the feature resets its chart/sort/filter state when it changes.
 *
 * ```tsx
 * import { useMemo } from 'react';
 * import { Provider } from 'jotai';
 * import { DataLabView, parseTable } from '~/components/DataLab';
 *
 * // A) From an already-parsed dataset:
 * function DataLabPage({ csv }: { csv: string }) {
 *   const dataset = useMemo(() => parseTable(csv, 'csv'), [csv]);
 *   return (
 *     <Provider>
 *       <DataLabView dataset={dataset} />
 *     </Provider>
 *   );
 * }
 *
 * // B) From an injected loader (no backend coupling inside the feature):
 * async function fetchDataset(): Promise<DataTable> {
 *   const response = await fetch('/api/datasets/current');
 *   return parseTable(await response.text(), 'json');
 * }
 *
 * <Provider>
 *   <DataLabView loadData={fetchDataset} />
 * </Provider>
 * ```
 *
 * A top-level route or command entry point can render `<DataLabView />` after
 * wrapping it in a Jotai `<Provider>` (or omitting the provider to share the
 * default store). All user-facing strings are localized through `useLocalize`;
 * the key registry in `labels.ts` names each one.
 */
export { default as DataLabView } from './DataLabView';
export { default as DataLabTable } from './DataLabTable';
export { default as AnalysisActions } from './AnalysisActions';
export { default as LineChart } from './charts/LineChart';
export { default as BarChart } from './charts/BarChart';
export { default as PieChart } from './charts/PieChart';
export {
  parseCsv,
  parseJson,
  parseTable,
  detectFormat,
  inferColumnType,
  coerceNumber,
  isNumericValue,
  isDateValue,
} from './parse';
export {
  describeTable,
  applyFilters,
  sortRows,
  deriveValues,
  aggregateByCategory,
} from './analysis';
export {
  dataLabChartKindAtom,
  dataLabSortAtom,
  dataLabFiltersAtom,
  dataLabDerivedSeriesAtom,
} from './atoms';
export { DATA_LAB_LABELS } from './labels';
export type { DataLabLabelKey } from './labels';
export type {
  BarChartProps,
  ChartKind,
  ChartSeriesDef,
  ColumnStats,
  DataCellValue,
  DataColumn,
  DataColumnType,
  DataFilter,
  DataRow,
  DataTable,
  DeriveMode,
  DerivedSeries,
  FilterOperator,
  LineChartProps,
  PieChartProps,
  SortDirection,
  SortState,
} from './types';
export type { DataFormat } from './parse';
export type { DataLabViewProps } from './DataLabView';
