/**
 * Feature-local English labels for Data Lab. These are the gaps that have no
 * shared `com_ui_*` key yet; prefer an existing key (`useLocalize`) when one
 * exists and promote these as they are merged.
 *
 * TODO(i18n): move every key below into
 * client/src/locales/en/translation.json (suggested prefix `com_ui_data_lab_`)
 * and replace this map with `useLocalize()` calls.
 */
export const DATA_LAB_LABELS = {
  title: 'Data Lab',
  description: 'Explore a tabular dataset with charts and quick statistics.',
  loading: 'Loading data…',
  retry: 'Retry',
  emptyTitle: 'Nothing to explore yet',
  emptyDescription: 'Provide a CSV or JSON dataset to start exploring.',
  failureTitle: 'Could not load the dataset',
  failureDescription: 'Something went wrong while preparing the data. Please try again.',
  chartSectionTitle: 'Chart',
  tableSectionTitle: 'Data table',
  chartLine: 'Line',
  chartBar: 'Bar',
  chartPie: 'Pie',
  chartNoData: 'Not enough numeric data to draw a chart.',
  chartLegend: 'Chart legend',
  chartAria: '{0} chart',
  chartDescription: '{0} across {1} rows',
  actions: 'Analysis actions',
  describe: 'Describe',
  describeTitle: 'Statistics',
  statColumn: 'Column',
  statType: 'Type',
  statCount: 'Count',
  statMissing: 'Missing',
  statUnique: 'Unique',
  statMin: 'Min',
  statMax: 'Max',
  statMean: 'Mean',
  statSum: 'Sum',
  filterColumn: 'Column',
  filterOperator: 'Operator',
  filterValue: 'Value',
  filterAdd: 'Add filter',
  filterClear: 'Clear filters',
  filterRemove: 'Remove filter',
  filterEmpty: 'No filters applied.',
  operatorContains: 'contains',
  operatorEquals: 'equals',
  operatorGreaterThan: 'greater than',
  operatorLessThan: 'less than',
  deriveColumn: 'Value column',
  deriveMode: 'Mode',
  deriveAdd: 'Derive series',
  modeCumulative: 'Running total',
  modePercent: 'Share of total',
  tableCaption: 'Dataset rows',
  tableEmpty: 'No rows match the current filters.',
  summaryRows: '{0} rows × {1} columns',
  sortBy: 'Sort by {0}',
  typeNumber: 'number',
  typeDate: 'date',
  typeString: 'text',
} as const;

export type DataLabLabelKey = keyof typeof DATA_LAB_LABELS;

export function formatDataLabLabel(
  key: DataLabLabelKey,
  values?: Record<string, string | number>,
): string {
  const template = DATA_LAB_LABELS[key];
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
