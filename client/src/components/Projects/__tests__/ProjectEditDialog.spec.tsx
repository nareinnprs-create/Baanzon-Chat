import { createElement } from 'react';
import { getDefaultStore } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationSeverity, ToastProvider, toastState } from '@librechat/client';
import type { ReactNode } from 'react';
import ProjectEditDialog from '../ProjectEditDialog';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

/** `@librechat/client` primitives localize through their own `useLocalize`, so the
 *  shared `t` has to resolve too — not just the `i18n` this dialog reads for locale. */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

const mockMutate = jest.fn();

/** Tenancy lists the workspace picker reads, keyed the queries key them. */
let mockOrganizations: Array<{ id: string; name: string }> = [];
let mockWorkspacesByOrg: Record<string, Array<{ id: string; name: string }>> = {};

jest.mock('~/data-provider', () => ({
  useUpdateProjectMutation: () => ({ mutate: mockMutate, isLoading: false }),
  useOrganizationsQuery: (config?: { enabled?: boolean }) => ({
    data: config?.enabled === false ? undefined : { organizations: mockOrganizations },
    isLoading: false,
  }),
  useWorkspacesQuery: (organizationId?: string | null, config?: { enabled?: boolean }) => ({
    data:
      organizationId != null && config?.enabled !== false
        ? { workspaces: mockWorkspacesByOrg[organizationId] ?? [] }
        : undefined,
    isLoading: false,
  }),
}));

const renderDialog = (project: Partial<typeof projectFixture> = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ToastProvider, null, children),
    );
  }
  return render(
    <ProjectEditDialog
      open={true}
      onOpenChange={jest.fn()}
      project={{ ...projectFixture, ...project }}
    />,
    {
      wrapper: Wrapper,
    },
  );
};

const projectFixture = {
  _id: 'proj-1',
  name: 'Roadmap',
  description: 'Q3 plans',
  workspaceId: null as string | null,
  conversationCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const singleOrg = () => {
  mockOrganizations = [{ id: 'org-1', name: 'Atlas' }];
  mockWorkspacesByOrg = {
    'org-1': [
      { id: 'ws-1', name: 'Platform' },
      { id: 'ws-2', name: 'Design' },
    ],
  };
};

const openWorkspacePicker = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> => {
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('combobox', { name: 'com_ui_project_workspace' }));
  return dialog;
};

describe('ProjectEditDialog workspace linking', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockOrganizations = [];
    mockWorkspacesByOrg = {};
  });

  it('renders the linked workspace by name and unlinks through the No workspace option', async () => {
    singleOrg();
    const user = userEvent.setup();
    renderDialog({ workspaceId: 'ws-1' });

    const dialog = await openWorkspacePicker(user);
    expect(
      within(dialog).getByRole('combobox', { name: 'com_ui_project_workspace' }),
    ).toHaveTextContent('Platform');

    await user.click(
      await within(dialog).findByRole('option', { name: 'com_ui_project_workspace_none' }),
    );

    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    expect(mockMutate.mock.calls[0][0]).toEqual({ projectId: 'proj-1', workspaceId: null });
  });

  it('links a workspace by picking it from the list', async () => {
    singleOrg();
    const user = userEvent.setup();
    renderDialog();

    const dialog = await openWorkspacePicker(user);
    await user.click(await within(dialog).findByRole('option', { name: 'Design' }));

    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    expect(mockMutate.mock.calls[0][0]).toEqual({ projectId: 'proj-1', workspaceId: 'ws-2' });
  });

  it('falls back to the stored id for a workspace the list has not loaded', () => {
    singleOrg();
    renderDialog({ workspaceId: 'ws-9' });

    expect(screen.getByRole('combobox', { name: 'com_ui_project_workspace' })).toHaveTextContent(
      'ws-9',
    );
  });

  /** The toast itself renders through the app shell's Toaster, absent here — the
   *  Jotai default store `useToast` writes is the observable contract. */
  it('reverts the pick and raises the error toast when the write fails', async () => {
    singleOrg();
    const user = userEvent.setup();
    renderDialog({ workspaceId: 'ws-1' });

    const dialog = await openWorkspacePicker(user);
    await user.click(
      await within(dialog).findByRole('option', { name: 'com_ui_project_workspace_none' }),
    );
    await waitFor(() => expect(mockMutate).toHaveBeenCalled());

    mockMutate.mock.calls[0][1].onError(new Error('boom'));

    /** `useToast` shows on a delay, so the store write lands a tick later. */
    await waitFor(() =>
      expect(getDefaultStore().get(toastState).message).toBe('com_ui_project_workspace_error'),
    );
    expect(getDefaultStore().get(toastState).severity).toBe(NotificationSeverity.ERROR);
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: 'com_ui_project_workspace' }),
      ).toHaveTextContent('Platform'),
    );
  });

  it('saves name and description without sending a workspace', async () => {
    singleOrg();
    const user = userEvent.setup();
    renderDialog({ workspaceId: 'ws-1' });

    const name = screen.getByRole('textbox', { name: 'com_ui_project_name' });
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    expect(mockMutate.mock.calls[0][0]).toEqual({
      projectId: 'proj-1',
      name: 'Renamed',
      description: 'Q3 plans',
    });
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('workspaceId');
  });

  it('offers no workspace picker when the caller has no organizations and the project is unlinked', () => {
    renderDialog();

    expect(
      screen.queryByRole('combobox', { name: 'com_ui_project_workspace' }),
    ).not.toBeInTheDocument();
  });

  it('adds an organization picker for multi-org callers and scopes the list to the pick', async () => {
    mockOrganizations = [
      { id: 'org-1', name: 'Atlas' },
      { id: 'org-2', name: 'Sales' },
    ];
    mockWorkspacesByOrg = {
      'org-1': [{ id: 'ws-1', name: 'Platform' }],
      'org-2': [{ id: 'ws-3', name: 'Pipeline' }],
    };
    const user = userEvent.setup();
    renderDialog();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'com_ui_project_organization' }));
    await user.click(await within(dialog).findByRole('option', { name: 'Sales' }));

    await user.click(within(dialog).getByRole('combobox', { name: 'com_ui_project_workspace' }));
    await user.click(await within(dialog).findByRole('option', { name: 'Pipeline' }));

    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    expect(mockMutate.mock.calls[0][0]).toEqual({ projectId: 'proj-1', workspaceId: 'ws-3' });
  });
});
