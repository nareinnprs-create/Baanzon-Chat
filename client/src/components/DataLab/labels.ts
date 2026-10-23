/**
 * i18n key registry for Data Lab. Every value is a `com_ui_data_lab_*` key in
 * `client/src/locales/en/translation.json`; render them through `useLocalize()`
 * as `localize(DATA_LAB_LABELS.name)`, passing `{ 0: value }` for keys whose
 * copy contains a `{{0}}` placeholder.
 *
 * Keeping the key literals here (rather than inline in each component) lets the
 * unused-i18n-keys check see them, and gives the feature one place to look up
 * the name of a label.
 */
export const DATA_LAB_LABELS = {
  title: 'com_ui_data_lab_title',
  description: 'com_ui_data_lab_description',
  loading: 'com_ui_data_lab_loading',
  retry: 'com_ui_data_lab_retry',
  emptyTitle: 'com_ui_data_lab_empty_title',
  emptyDescription: 'com_ui_data_lab_empty_description',
  failureTitle: 'com_ui_data_lab_failure_title',
  failureDescription: 'com_ui_data_lab_failure_description',
  chartSectionTitle: 'com_ui_data_lab_chart_section_title',
  tableSectionTitle: 'com_ui_data_lab_table_section_title',
  chartLine: 'com_ui_data_lab_chart_line',
  chartBar: 'com_ui_data_lab_chart_bar',
  chartPie: 'com_ui_data_lab_chart_pie',
  chartNoData: 'com_ui_data_lab_chart_no_data',
  chartLegend: 'com_ui_data_lab_chart_legend',
  chartAria: 'com_ui_data_lab_chart_aria',
  chartDescription: 'com_ui_data_lab_chart_description',
  actions: 'com_ui_data_lab_actions',
  describe: 'com_ui_data_lab_describe',
  describeTitle: 'com_ui_data_lab_describe_title',
  statColumn: 'com_ui_data_lab_stat_column',
  statType: 'com_ui_data_lab_stat_type',
  statCount: 'com_ui_data_lab_stat_count',
  statMissing: 'com_ui_data_lab_stat_missing',
  statUnique: 'com_ui_data_lab_stat_unique',
  statMin: 'com_ui_data_lab_stat_min',
  statMax: 'com_ui_data_lab_stat_max',
  statMean: 'com_ui_data_lab_stat_mean',
  statSum: 'com_ui_data_lab_stat_sum',
  filterColumn: 'com_ui_data_lab_filter_column',
  filterOperator: 'com_ui_data_lab_filter_operator',
  filterValue: 'com_ui_data_lab_filter_value',
  filterAdd: 'com_ui_data_lab_filter_add',
  filterClear: 'com_ui_data_lab_filter_clear',
  filterRemove: 'com_ui_data_lab_filter_remove',
  filterEmpty: 'com_ui_data_lab_filter_empty',
  operatorContains: 'com_ui_data_lab_operator_contains',
  operatorEquals: 'com_ui_data_lab_operator_equals',
  operatorGreaterThan: 'com_ui_data_lab_operator_greater_than',
  operatorLessThan: 'com_ui_data_lab_operator_less_than',
  deriveColumn: 'com_ui_data_lab_derive_column',
  deriveMode: 'com_ui_data_lab_derive_mode',
  deriveAdd: 'com_ui_data_lab_derive_add',
  modeCumulative: 'com_ui_data_lab_mode_cumulative',
  modePercent: 'com_ui_data_lab_mode_percent',
  tableCaption: 'com_ui_data_lab_table_caption',
  tableEmpty: 'com_ui_data_lab_table_empty',
  summaryRows: 'com_ui_data_lab_summary_rows',
  sortBy: 'com_ui_data_lab_sort_by',
  typeNumber: 'com_ui_data_lab_type_number',
  typeDate: 'com_ui_data_lab_type_date',
  typeString: 'com_ui_data_lab_type_string',
} as const;

export type DataLabLabelKey = keyof typeof DATA_LAB_LABELS;
