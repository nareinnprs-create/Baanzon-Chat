import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  MAX_CHAT_PROJECT_NAME_LENGTH,
  MAX_CHAT_PROJECT_DESCRIPTION_LENGTH,
} from 'librechat-data-provider';
import {
  Button,
  ControlCombobox,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Textarea,
  useToastContext,
} from '@librechat/client';
import type { TChatProject } from 'librechat-data-provider';
import {
  useOrganizationsQuery,
  useUpdateProjectMutation,
  useWorkspacesQuery,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

type ProjectEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: TChatProject;
};

/** The combobox value standing in for "no workspace" — unlinking on the wire. */
const NO_WORKSPACE = '';

export default function ProjectEditDialog({ open, onOpenChange, project }: ProjectEditDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [workspaceId, setWorkspaceId] = useState<string | null>(project.workspaceId ?? null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const updateProject = useUpdateProjectMutation();
  const { showToast } = useToastContext();

  const organizationsQuery = useOrganizationsQuery({ enabled: open });
  const organizations = useMemo(
    () => organizationsQuery.data?.organizations ?? [],
    [organizationsQuery.data],
  );
  /** A single organization is chosen for the caller; more need an explicit pick. */
  const resolvedOrganizationId = organizations.length === 1 ? organizations[0].id : organizationId;
  const workspacesQuery = useWorkspacesQuery(resolvedOrganizationId, {
    enabled: open && resolvedOrganizationId != null,
  });
  const workspaces = useMemo(() => workspacesQuery.data?.workspaces ?? [], [workspacesQuery.data]);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(project.name);
      setDescription(project.description ?? '');
      setWorkspaceId(project.workspaceId ?? null);
      setOrganizationId(null);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const isUnchanged =
    trimmedName === project.name && trimmedDescription === (project.description ?? '').trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmedName || isUnchanged || updateProject.isLoading) {
      return;
    }

    updateProject.mutate(
      {
        projectId: project._id,
        name: trimmedName,
        description: trimmedDescription,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: () =>
          showToast({
            message: localize('com_ui_project_rename_error'),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          }),
      },
    );
  };

  /**
   * A workspace pick (or "No workspace") is its own immediate write, separate
   * from the name/description save: `workspaceId: null` detaches, a name links.
   * No optimistic cache writes — the mutation settles the cache, and a failure
   * falls back to the project's stored workspace.
   */
  const handleWorkspaceChange = (next: string) => {
    const nextWorkspaceId = next === NO_WORKSPACE ? null : next;
    if (updateProject.isLoading || nextWorkspaceId === workspaceId) {
      return;
    }
    setWorkspaceId(nextWorkspaceId);
    updateProject.mutate(
      { projectId: project._id, workspaceId: nextWorkspaceId },
      {
        onSuccess: (updated) => setWorkspaceId(updated.workspaceId ?? null),
        onError: () => {
          setWorkspaceId(project.workspaceId ?? null);
          showToast({
            message: localize('com_ui_project_workspace_error'),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          });
        },
      },
    );
  };

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  /** An unlinked project reads as "No workspace"; a linked one whose list has not
   *  loaded (or that belongs to another organization) falls back to its stored id
   *  rather than pretending to be unscoped. */
  const workspaceDisplay =
    workspaceId == null
      ? localize('com_ui_project_workspace_none')
      : (selectedWorkspace?.name ?? workspaceId);

  const organizationItems = useMemo(
    () =>
      organizations.map((organization) => ({ label: organization.name, value: organization.id })),
    [organizations],
  );
  const workspaceItems = useMemo(
    () => [
      { label: localize('com_ui_project_workspace_none'), value: NO_WORKSPACE },
      ...workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id })),
    ],
    [localize, workspaces],
  );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_edit_project')}
        showCloseButton={false}
        className="w-11/12 max-w-md"
        main={
          <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-name`} className="text-sm font-medium text-text-primary">
                {localize('com_ui_project_name')}
              </Label>
              <Input
                id={`${formId}-name`}
                ref={inputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_CHAT_PROJECT_NAME_LENGTH}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor={`${formId}-description`}
                className="text-sm font-medium text-text-primary"
              >
                {localize('com_ui_description')}{' '}
                <span className="font-normal text-text-secondary">
                  {localize('com_ui_optional')}
                </span>
              </Label>
              <Textarea
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={MAX_CHAT_PROJECT_DESCRIPTION_LENGTH}
                className="min-h-[4.5rem] bg-transparent"
              />
            </div>
            {organizations.length > 1 && (
              <fieldset className="space-y-2">
                <legend>
                  <Label className="text-sm font-medium text-text-primary">
                    {localize('com_ui_project_organization')}
                  </Label>
                </legend>
                <ControlCombobox
                  selectedValue={resolvedOrganizationId ?? NO_WORKSPACE}
                  displayValue={
                    organizations.find((organization) => organization.id === resolvedOrganizationId)
                      ?.name
                  }
                  selectPlaceholder={localize('com_ui_project_organization')}
                  searchPlaceholder={localize('com_ui_project_organization')}
                  setValue={setOrganizationId}
                  items={organizationItems}
                  ariaLabel={localize('com_ui_project_organization')}
                  selectId={`${formId}-organization`}
                  isCollapsed={false}
                  showCarat={true}
                  placement="bottom-start"
                  /** Radix traps focus, so the list must render inside the dialog. */
                  portal={false}
                  matchTriggerWidth={true}
                  variant="field"
                />
              </fieldset>
            )}
            {(organizations.length > 0 || project.workspaceId != null) && (
              <fieldset className="space-y-2">
                <legend>
                  <Label className="text-sm font-medium text-text-primary">
                    {localize('com_ui_project_workspace')}
                  </Label>
                </legend>
                <ControlCombobox
                  selectedValue={workspaceId ?? NO_WORKSPACE}
                  displayValue={workspaceDisplay}
                  selectPlaceholder={localize('com_ui_project_workspace_none')}
                  searchPlaceholder={localize('com_ui_project_workspace_search')}
                  setValue={handleWorkspaceChange}
                  items={workspaceItems}
                  ariaLabel={localize('com_ui_project_workspace')}
                  selectId={`${formId}-workspace`}
                  isCollapsed={false}
                  showCarat={true}
                  placement="bottom-start"
                  portal={false}
                  matchTriggerWidth={true}
                  variant="field"
                  disabled={updateProject.isLoading || workspacesQuery.isLoading}
                />
              </fieldset>
            )}
          </form>
        }
        buttons={
          <Button
            type="submit"
            form={formId}
            variant="submit"
            disabled={!trimmedName || isUnchanged || updateProject.isLoading}
            className="active:scale-[0.96]"
          >
            {updateProject.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
