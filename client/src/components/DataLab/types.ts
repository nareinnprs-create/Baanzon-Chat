/**
 * Shared types for the Data Lab feature. Everything here is plain data so the
 * parsing, charting and table helpers can be exercised without React or a
 * backend.
 */

/** The three column shapes the parser can infer. */
export type DataColumnType = 'number' | 'date' | 'string';

/** A cell holds a primitive; `null` marks a missing value. */
export type DataCellValue = string | number | null;

/** A row keyed by column key. */
export type DataRow = Record<string, DataCellValue>;

export interface DataColumn {
  key: string;
  label: string;
  type: DataColumnType;
}

/** A tabular dataset: an ordered column list plus its rows. */
export interface DataTable {
  columns: DataColumn[];
  rows: DataRow[];
}

/** Which chart the view renders. */
export type ChartKind = 'line' | 'bar' | 'pie';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

export type FilterOperator = 'contains' | 'equals' | 'greaterThan' | 'lessThan';

export interface DataFilter {
  column: string;
  operator: FilterOperator;
  value: string;
}

/** How a derived series is computed from a numeric column. */
export type DeriveMode = 'cumulative' | 'percent';

export interface DerivedSeries {
  key: string;
  label: string;
  column: string;
  mode: DeriveMode;
}

export interface ColumnStats {
  key: string;
  label: string;
  type: DataColumnType;
  count: number;
  missing: number;
  unique: number;
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
}

/** Accessors charts accept: a value lookup for a row at a given index. */
export type ValueAccessor = (row: DataRow, index: number) => DataCellValue;
export type NumberAccessor = (row: DataRow, index: number) => number;
export type LabelAccessor = (row: DataRow, index: number) => string;

export interface ChartSeriesDef {
  key: string;
  label: string;
  value: NumberAccessor;
}

export interface ChartCommonProps {
  /** Accessible name for the rendered SVG (`role="img"`). */
  ariaLabel: string;
  title?: string;
  /** Longer accessible description rendered as `<desc>`. */
  description?: string;
  /** Shown when there is nothing to plot. */
  emptyLabel?: string;
  className?: string;
}

export interface LineChartProps extends ChartCommonProps {
  data: DataRow[];
  x: LabelAccessor;
  xLabel?: string;
  series: ChartSeriesDef[];
}

export interface BarChartProps extends ChartCommonProps {
  data: DataRow[];
  x: LabelAccessor;
  xLabel?: string;
  series: ChartSeriesDef[];
}

export interface PieChartProps extends ChartCommonProps {
  data: DataRow[];
  category: LabelAccessor;
  value: NumberAccessor;
}
