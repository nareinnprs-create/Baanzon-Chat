import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2 } from 'lucide-react';
import { createStore, Provider as JotaiProvider, useAtomValue } from 'jotai';
import {
  Alert,
  Button,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@librechat/client';
import type {
  TenantLevel,
  TenantLoadStatus,
  TenantOrganization,
  TenantProject,
  TenantSelection,
  TenantWorkspace,
} from '~/utils/tenant/types';
import {
  seedTenantAtom,
  selectTenantOrganizationAtom,
  selectTenantProjectAtom,
  selectTenantWorkspaceAtom,
  setTenantDirectoryAtom,
  tenantAvailableProjectsAtom,
  tenantAvailableWorkspacesAtom,
  tenantErrorAtom,
  tenantOrganizationIdAtom,
  tenantOrganizationsAtom,
  tenantProjectIdAtom,
  tenantSelectionAtom,
  tenantStatusAtom,
  tenantWorkspaceIdAtom,
} from './atoms';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The cascading organization → workspace → project picker for the P7 tenant
 * hierarchy.
 *
 * It owns no transport: the loaded lists and the load lifecycle arrive as
 * props, are mirrored into the feature-owned atoms, and the host decides where
 * they come from (`useTenantDirectory` is the supplied loader-backed helper).
 * Nothing is persisted here either — `initialSelection` seeds the scope and
 * `onChange` hands the next one back, so remembering it is the host's job.
 */

/** A Jotai store built per instance, or one the host already owns. */
export type TenantStore = ReturnType<typeof createStore>;

export interface TenantSwitcherProps {
  /** Organizations the user belongs to, in display order. */
  organizations?: readonly TenantOrganization[];
  /** Workspaces; the switcher narrows these to the selected organization. */
  workspaces?: readonly TenantWorkspace[];
  /** Projects; the switcher narrows these to the selected workspace. */
  projects?: readonly TenantProject[];
  /** Load lifecycle for the lists above. */
  status?: TenantLoadStatus;
  /** Failure detail to show verbatim, usually server prose. */
  error?: string | null;
  /** The scope to open on. Never persisted by the feature. */
  initialSelection?: Partial<TenantSelection>;
  /** Called with the whole scope after every pick, cascade resets included. */
  onChange?: (selection: TenantSelection) => void;
  /** Wired to the retry affordance in the error state; omitted hides the button. */
  onRetry?: () => void;
  /** Share one store across sibling reads; omit to let the switcher own one. */
  store?: TenantStore;
  className?: string;
}

/**
 * The value Radix carries for "not narrowed here". Radix forbids an empty
 * string as an item value, and a scoped hierarchy needs a real, selectable
 * "no narrower level" choice rather than a placeholder that looks chosen.
 */
const NONE_VALUE = '__tenant_none__';

/**
 * Stable defaults, so the props-mirroring effect is not re-run on every render:
 * a fresh `[]` literal would be a new reference each time, and each one would
 * be a fresh directory write.
 */
const NO_ORGANIZATIONS: readonly TenantOrganization[] = [];
const NO_WORKSPACES: readonly TenantWorkspace[] = [];
const NO_PROJECTS: readonly TenantProject[] = [];

export default function TenantSwitcher({
  organizations = NO_ORGANIZATIONS,
  workspaces = NO_WORKSPACES,
  projects = NO_PROJECTS,
  status = 'idle',
  error = null,
  initialSelection,
  onChange,
  onRetry,
  store,
  className,
}: TenantSwitcherProps) {
  const [owned] = useState<TenantStore>(() => createStore());
  const resolved = store ?? owned;

  /**
   * Seeded once per resolved store rather than once per mount. A host that
   * shares a store through `store` must get `initialSelection` too — seeding
   * the private store instead would leave a shared scope at the unscoped root
   * — while re-seeding on every render would throw away the user's own picks.
   */
  const seeded = useRef<TenantStore | null>(null);
  if (seeded.current !== resolved) {
    resolved.set(seedTenantAtom, {
      selection: initialSelection,
      directory: { organizations, workspaces, projects, status, error },
    });
    seeded.current = resolved;
  }

  const content = (
    <TenantSwitcherFields
      organizations={organizations}
      workspaces={workspaces}
      projects={projects}
      status={status}
      error={error}
      onChange={onChange}
      onRetry={onRetry}
      store={resolved}
      className={className}
    />
  );

  return store != null ? content : <JotaiProvider store={resolved}>{content}</JotaiProvider>;
}

interface TenantSwitcherFieldsProps
  extends Omit<TenantSwitcherProps, 'initialSelection' | 'store'> {
  store: TenantStore;
}

function TenantSwitcherFields({
  organizations,
  workspaces,
  projects,
  status,
  error,
  onChange,
  onRetry,
  store,
  className,
}: TenantSwitcherFieldsProps) {
  const localize = useLocalize();
  const directoryStatus = useAtomValue(tenantStatusAtom);
  const directoryError = useAtomValue(tenantErrorAtom);
  const loadedOrganizations = useAtomValue(tenantOrganizationsAtom);
  const availableWorkspaces = useAtomValue(tenantAvailableWorkspacesAtom);
  const availableProjects = useAtomValue(tenantAvailableProjectsAtom);
  const organizationId = useAtomValue(tenantOrganizationIdAtom);
  const workspaceId = useAtomValue(tenantWorkspaceIdAtom);
  const projectId = useAtomValue(tenantProjectIdAtom);

  /**
   * The props are the host's view of the directory, so they are what gets
   * mirrored into the atoms; the atoms are how the rest of the app reads the
   * scope. Mirroring here, rather than in each consumer, is what lets a
   * breadcrumb show the same scope the switcher shows.
   */
  useEffect(() => {
    store.set(setTenantDirectoryAtom, { organizations, workspaces, projects, status, error });
  }, [store, organizations, workspaces, projects, status, error]);

  const handleSelect = useCallback(
    (level: TenantLevel, chosen: string | null) => {
      if (level === 'organizationId') {
        store.set(selectTenantOrganizationAtom, chosen);
      } else if (level === 'workspaceId') {
        store.set(selectTenantWorkspaceAtom, chosen);
      } else {
        store.set(selectTenantProjectAtom, chosen);
      }
      onChange?.(store.get(tenantSelectionAtom));
    },
    [onChange, store],
  );

  const isLoading = directoryStatus === 'loading';
  const hasFailed = directoryError != null;
  /** Nothing to narrow yet: skeletons rather than three empty pickers. */
  const showSkeleton = isLoading && !hasFailed && loadedOrganizations.length === 0;
  /** A loaded directory with no organizations is an empty account, not a failure. */
  const showEmpty =
    !showSkeleton &&
    !hasFailed &&
    directoryStatus !== 'loading' &&
    loadedOrganizations.length === 0;
  /** Every control is inert while a read is in flight or the last one failed. */
  const controlsDisabled = isLoading || hasFailed;

  const nameOf = (options: readonly { id: string; name: string }[], id: string | null) =>
    id == null ? null : (options.find((option) => option.id === id)?.name ?? id);

  /** Read out after every pick, because a cascade silently clears the levels below. */
  const scopeAnnouncement = [
    {
      label: localize('com_ui_tenant_organization'),
      name: nameOf(loadedOrganizations, organizationId),
    },
    { label: localize('com_ui_tenant_workspace'), name: nameOf(availableWorkspaces, workspaceId) },
    { label: localize('com_ui_tenant_project'), name: nameOf(availableProjects, projectId) },
  ]
    .filter((level) => level.name != null)
    .map((level) => `${level.label}: ${level.name}`)
    .join(', ');

  return (
    <div className={cn('flex w-full flex-col gap-3', className)} data-testid="tenant-switcher">
      {hasFailed ? (
        <Alert variant="error">
          <p className="font-medium">{localize('com_ui_tenant_load_error_title')}</p>
          <p className="mt-0.5 text-xs opacity-90">
            {localize('com_ui_tenant_load_error_description')}
          </p>
          {directoryError != null && <p className="mt-0.5 text-xs opacity-90">{directoryError}</p>}
          {onRetry != null && (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
              {localize('com_ui_retry')}
            </Button>
          )}
        </Alert>
      ) : null}

      {showSkeleton ? (
        <div role="status" className="flex flex-col gap-3" data-testid="tenant-switcher-skeleton">
          <span className="sr-only">{localize('com_ui_tenant_loading')}</span>
          {[0, 1, 2].map((level) => (
            <div key={level} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      {showEmpty ? (
        <EmptyState
          icon={Building2}
          title={localize('com_ui_tenant_no_organizations_title')}
          description={localize('com_ui_tenant_no_organizations_description')}
        />
      ) : null}

      {!showSkeleton && !showEmpty ? (
        <div
          role="group"
          aria-label={localize('com_ui_tenant_scope_group')}
          className="grid gap-3 sm:grid-cols-3"
        >
          <TenantSelectField
            fieldId="tenant-organization"
            label={localize('com_ui_tenant_organization')}
            unscopedLabel={localize('com_ui_tenant_all_organizations')}
            value={organizationId}
            options={loadedOrganizations}
            disabled={controlsDisabled || loadedOrganizations.length === 0}
            onSelect={(chosen) => handleSelect('organizationId', chosen)}
          />
          <TenantSelectField
            fieldId="tenant-workspace"
            label={localize('com_ui_tenant_workspace')}
            unscopedLabel={localize('com_ui_tenant_all_workspaces')}
            value={workspaceId}
            options={availableWorkspaces}
            disabled={
              controlsDisabled || organizationId == null || availableWorkspaces.length === 0
            }
            hint={levelHint(
              organizationId,
              availableWorkspaces.length,
              localize('com_ui_tenant_select_organization_hint'),
              localize('com_ui_tenant_no_workspaces'),
            )}
            onSelect={(chosen) => handleSelect('workspaceId', chosen)}
          />
          <TenantSelectField
            fieldId="tenant-project"
            label={localize('com_ui_tenant_project')}
            unscopedLabel={localize('com_ui_tenant_all_projects')}
            value={projectId}
            options={availableProjects}
            disabled={controlsDisabled || workspaceId == null || availableProjects.length === 0}
            hint={levelHint(
              workspaceId,
              availableProjects.length,
              localize('com_ui_tenant_select_workspace_hint'),
              localize('com_ui_tenant_no_projects'),
            )}
            onSelect={(chosen) => handleSelect('projectId', chosen)}
          />
        </div>
      ) : null}

      <span className="sr-only" role="status">
        {scopeAnnouncement}
      </span>
    </div>
  );
}

interface TenantSelectFieldProps {
  fieldId: string;
  label: string;
  /** Text of the selectable "not narrowed here" option. */
  unscopedLabel: string;
  value: string | null;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  hint?: string | undefined;
  onSelect: (value: string | null) => void;
}

/**
 * Why a level cannot be narrowed: either its parent is still unscoped, or the
 * parent resolved to nothing. Stated as a function because the two reads in a
 * JSX expression are indistinguishable from a nested conditional.
 */
function levelHint(
  parentId: string | null,
  childCount: number,
  selectParentHint: string,
  emptyChildHint: string,
): string | undefined {
  if (parentId == null) {
    return selectParentHint;
  }
  if (childCount === 0) {
    return emptyChildHint;
  }
  return undefined;
}

function TenantSelectField({
  fieldId,
  label,
  unscopedLabel,
  value,
  options,
  disabled,
  hint,
  onSelect,
}: TenantSelectFieldProps) {
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label id={labelId} htmlFor={fieldId} variant="section">
        {label}
      </Label>
      <Select
        value={value ?? NONE_VALUE}
        disabled={disabled}
        onValueChange={(chosen) => onSelect(chosen === NONE_VALUE ? null : chosen)}
      >
        <SelectTrigger
          id={fieldId}
          aria-labelledby={labelId}
          aria-describedby={hint != null ? hintId : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>{unscopedLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint != null && (
        <p id={hintId} className="text-xs text-text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}
