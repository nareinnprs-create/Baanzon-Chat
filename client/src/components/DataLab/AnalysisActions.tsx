import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Dropdown, Input } from '@librechat/client';
import type { DataColumn, DataFilter, DeriveMode, DerivedSeries, FilterOperator } from './types';
import { DATA_LAB_LABELS } from './labels';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface AnalysisActionsProps {
  columns: DataColumn[];
  filters: DataFilter[];
  onAddFilter: (filter: DataFilter) => void;
  onRemoveFilter: (index: number) => void;
  onClearFilters: () => void;
  onDescribe: () => void;
  onDerive: (series: DerivedSeries) => void;
  describeActive?: boolean;
  className?: string;
}

const OPERATORS: FilterOperator[] = ['contains', 'equals', 'greaterThan', 'lessThan'];

type Localize = ReturnType<typeof useLocalize>;

function operatorLabel(operator: FilterOperator, localize: Localize): string {
  if (operator === 'equals') {
    return localize(DATA_LAB_LABELS.operatorEquals);
  }
  if (operator === 'greaterThan') {
    return localize(DATA_LAB_LABELS.operatorGreaterThan);
  }
  if (operator === 'lessThan') {
    return localize(DATA_LAB_LABELS.operatorLessThan);
  }
  return localize(DATA_LAB_LABELS.operatorContains);
}

function modeLabel(mode: DeriveMode, localize: Localize): string {
  return mode === 'percent'
    ? localize(DATA_LAB_LABELS.modePercent)
    : localize(DATA_LAB_LABELS.modeCumulative);
}

/**
 * Pure action bar for the Data Lab. Every action is surfaced through a callback
 * and the active filter list arrives as a prop, so the bar has no data or
 * backend coupling — it only composes the filter and derived-series inputs.
 */
export default function AnalysisActions({
  columns,
  filters,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onDescribe,
  onDerive,
  describeActive = false,
  className,
}: AnalysisActionsProps) {
  const localize = useLocalize();
  const [filterColumn, setFilterColumn] = useState('');
  const [operator, setOperator] = useState<FilterOperator>('contains');
  const [filterValue, setFilterValue] = useState('');
  const [deriveColumn, setDeriveColumn] = useState('');
  const [deriveMode, setDeriveMode] = useState<DeriveMode>('cumulative');

  const numericColumns = columns.filter((column) => column.type === 'number');
  const activeColumn = columns.some((column) => column.key === filterColumn)
    ? filterColumn
    : (columns[0]?.key ?? '');
  const activeDeriveColumn = numericColumns.some((column) => column.key === deriveColumn)
    ? deriveColumn
    : (numericColumns[0]?.key ?? '');

  const columnOptions = columns.map((column) => ({
    value: column.key,
    label: column.label,
  }));
  const operatorOptions = OPERATORS.map((item) => ({
    value: item,
    label: operatorLabel(item, localize),
  }));
  const numericOptions = numericColumns.map((column) => ({
    value: column.key,
    label: column.label,
  }));
  const modeOptions: Array<{ value: DeriveMode; label: string }> = [
    { value: 'cumulative', label: modeLabel('cumulative', localize) },
    { value: 'percent', label: modeLabel('percent', localize) },
  ];

  const handleAddFilter = () => {
    if (!activeColumn || filterValue.trim() === '') {
      return;
    }
    onAddFilter({ column: activeColumn, operator, value: filterValue.trim() });
    setFilterValue('');
  };

  const handleDerive = () => {
    if (!activeDeriveColumn) {
      return;
    }
    const columnLabel =
      numericColumns.find((column) => column.key === activeDeriveColumn)?.label ??
      activeDeriveColumn;
    onDerive({
      key: `derived_${activeDeriveColumn}_${deriveMode}`,
      label: `${columnLabel} (${modeLabel(deriveMode, localize)})`,
      column: activeDeriveColumn,
      mode: deriveMode,
    });
  };

  const describeFilter = (filter: DataFilter): string => {
    const column = columns.find((item) => item.key === filter.column);
    return `${column?.label ?? filter.column} ${operatorLabel(filter.operator, localize)} ${filter.value}`;
  };

  return (
    <div
      role="group"
      aria-label={localize(DATA_LAB_LABELS.actions)}
      className={cn('flex flex-col gap-3', className)}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Button
          type="button"
          variant={describeActive ? 'default' : 'outline'}
          size="sm"
          aria-pressed={describeActive}
          onClick={onDescribe}
        >
          {localize(DATA_LAB_LABELS.describe)}
        </Button>
        <Dropdown
          ariaLabel={localize(DATA_LAB_LABELS.filterColumn)}
          value={activeColumn}
          onChange={setFilterColumn}
          options={columnOptions}
          sizeClasses="w-40"
          testId="datalab-filter-column"
        />
        <Dropdown
          ariaLabel={localize(DATA_LAB_LABELS.filterOperator)}
          value={operator}
          onChange={(value) => setOperator(value as FilterOperator)}
          options={operatorOptions}
          sizeClasses="w-40"
          testId="datalab-filter-operator"
        />
        <Input
          aria-label={localize(DATA_LAB_LABELS.filterValue)}
          placeholder={localize(DATA_LAB_LABELS.filterValue)}
          value={filterValue}
          onChange={(event) => setFilterValue(event.target.value)}
          className="w-40"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!activeColumn || filterValue.trim() === ''}
          onClick={handleAddFilter}
        >
          <Plus className="size-4" aria-hidden="true" />
          {localize(DATA_LAB_LABELS.filterAdd)}
        </Button>
      </div>

      {filters.length === 0 ? (
        <p className="text-xs text-text-secondary">{localize(DATA_LAB_LABELS.filterEmpty)}</p>
      ) : (
        <ul className="flex flex-wrap items-center gap-2">
          {filters.map((filter, index) => (
            <li
              key={`${filter.column}-${filter.operator}-${filter.value}-${index}`}
              className="inline-flex items-center gap-1 rounded-full border border-border-light bg-surface-tertiary py-0.5 pl-2.5 pr-1 text-xs text-text-primary"
            >
              <span>{describeFilter(filter)}</span>
              <button
                type="button"
                aria-label={localize(DATA_LAB_LABELS.filterRemove)}
                onClick={() => onRemoveFilter(index)}
                className="rounded-full p-0.5 hover:bg-surface-hover"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
              {localize(DATA_LAB_LABELS.filterClear)}
            </Button>
          </li>
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Dropdown
          ariaLabel={localize(DATA_LAB_LABELS.deriveColumn)}
          value={activeDeriveColumn}
          onChange={setDeriveColumn}
          options={numericOptions}
          disabled={numericOptions.length === 0}
          sizeClasses="w-40"
          testId="datalab-derive-column"
        />
        <Dropdown
          ariaLabel={localize(DATA_LAB_LABELS.deriveMode)}
          value={deriveMode}
          onChange={(value) => setDeriveMode(value as DeriveMode)}
          options={modeOptions}
          sizeClasses="w-40"
          testId="datalab-derive-mode"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!activeDeriveColumn}
          onClick={handleDerive}
        >
          {localize(DATA_LAB_LABELS.deriveAdd)}
        </Button>
      </div>
    </div>
  );
}
