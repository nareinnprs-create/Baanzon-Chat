/**
 * Deep Research — a self-contained client flow: editable plan → run with
 * progress → pause/resume → report.
 *
 * Everything the flow needs lives in this folder. It owns its state in Jotai
 * atoms (`./atoms`) and never reaches into `~/store`, Recoil or a
 * data-provider endpoint. The only seam to a backend is the
 * `DeepResearchExecutor` interface in `./api`, supplied as a prop.
 *
 * ## Mounting
 *
 * ```tsx
 * import { Provider as JotaiProvider, createStore } from 'jotai';
 * import { DeepResearchView, createInMemoryExecutor } from '~/components/DeepResearch';
 *
 * // A real integration passes an executor that talks to its backend; the
 * // in-memory one is a working default and what the tests use.
 * const executor = createInMemoryExecutor();
 *
 * export function DeepResearchPage() {
 *   return (
 *     <JotaiProvider store={createStore()}>
 *       <DeepResearchView executor={executor} />
 *     </JotaiProvider>
 *   );
 * }
 * ```
 *
 * Mount it under a fresh Jotai `Provider` when you want isolated state per
 * mount (recommended in tests and for multiple concurrent instances); without
 * one it uses Jotai's default store.
 */

export { default as DeepResearchView } from './DeepResearchView';
export { default as PlanEditor } from './PlanEditor';
export { default as ProgressTimeline } from './ProgressTimeline';
export { default as ReportView } from './ReportView';
export { createInMemoryExecutor } from './api';
export {
  createInitialState,
  deepResearchReducer,
  countCompletedSteps,
  isPlanEditable,
  selectActiveStep,
} from './state';
export type { DeepResearchViewProps } from './DeepResearchView';
export type { PlanEditorProps } from './PlanEditor';
export type { ProgressTimelineProps } from './ProgressTimeline';
export type { ReportViewProps } from './ReportView';
export type { DeepResearchExecutor, ResearchStepResult, StepProgressCallback } from './api';
export type { DeepResearchAction, DeepResearchState } from './state';
export type {
  ResearchCitation,
  ResearchEvent,
  ResearchEventKind,
  ResearchPlan,
  ResearchReport,
  ResearchSection,
  ResearchStatus,
  ResearchStep,
  StepStatus,
} from './types';
