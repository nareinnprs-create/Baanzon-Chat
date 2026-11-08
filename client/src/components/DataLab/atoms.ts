import { atom } from 'jotai';
import type { ChartKind, DataFilter, DerivedSeries, SortState } from './types';

/**
 * Feature-owned Jotai slice for Data Lab. The chart kind, the table sort, the
 * active filters and any derived series are written and read only by this
 * feature, so they live here instead of `~/store`.
 */
export const dataLabChartKindAtom = atom<ChartKind>('line');

export const dataLabSortAtom = atom<SortState | null>(null);

export const dataLabFiltersAtom = atom<DataFilter[]>([]);

export const dataLabDerivedSeriesAtom = atom<DerivedSeries[]>([]);
