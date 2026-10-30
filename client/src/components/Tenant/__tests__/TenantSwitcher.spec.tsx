import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import { createStore, Provider as JotaiProvider, useAtomValue } from 'jotai';
import type {
  TenantOrganization,
  TenantProject,
  TenantSwitcherProps,
  TenantWorkspace,
} from '../index';
import { tenantSelectionAtom } from '../atoms';
import TenantSwitcher from '../TenantSwitcher';

/**
 * Radix opens its listbox in a portal from a pointer sequence jsdom does not
 * reproduce, so the Select family is swapped for a native `<select>` — the same
 * trade `StatefulWorkspaceDefault.spec.tsx` makes. The trigger's own props are
 * carried onto that control, so the accessible name and the hint wiring the
 * component is responsible for are still asserted below; everything else is the
 * real primitive.
 */
jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  const { Children, isValidElement } = jest.requireActual('react');

  /** The trigger is the only child carrying the label reference. */
  const isTrigger = (child) => isValidElement(child) && child.props?.['aria-labelledby'] != null;

  return {
    ...actual,
    Select: ({ children, value, onValueChange, disabled }) => {
      const trigger = Children.toArray(children).find(isTrigger);
      const props = (isValidElement(trigger) ? trigger.props : {}) ?? {};
      return (
        <select
          id={props.id}
          aria-labelledby={props['aria-labelledby']}
          aria-describedby={props['aria-describedby']}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {Children.map(children, (child) => (isTrigger(child) ? null : child))}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <>{children}</>,
    SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
  };
});

const ORGANIZATIONS: readonly TenantOrganization[] = [
  { id: 'org-1', name: 'Northwind' },
  { id: 'org-2', name: 'Contoso' },
];

const WORKSPACES: readonly TenantWorkspace[] = [
  { id: 'ws-1', organizationId: 'org-1', name: 'Platform' },
  { id: 'ws-2', organizationId: 'org-1', name: 'Design' },
  { id: 'ws-3', organizationId: 'org-2', name: 'Sales' },
];

const PROJECTS: readonly TenantProject[] = [
  { id: 'proj-1', workspaceId: 'ws-1', name: 'Atlas' },
  { id: 'proj-2', workspaceId: 'ws-2', name: 'Palette' },
  { id: 'proj-3', workspaceId: 'ws-3', name: 'Pipeline' },
];

/** A ready directory with the whole cascade loaded. */
function directoryProps(): TenantSwitcherProps {
  return {
    organizations: ORGANIZATIONS,
    workspaces: WORKSPACES,
    projects: PROJECTS,
    status: 'ready',
  };
}

function renderSwitcher(props: Partial<TenantSwitcherProps> = {}) {
  return render(<TenantSwitcher {...directoryProps()} {...props} />);
}

/** The level's control, found by the label the switcher renders above it. */
function levelControl(name: RegExp | string): HTMLSelectElement {
  return screen.getByRole('combobox', { name }) as HTMLSelectElement;
}

/** The text of the level's current pick, which is its unscoped option at the root. */
function chosen(name: RegExp | string): string {
  const control = levelControl(name);
  return control.options[control.selectedIndex]?.textContent ?? '';
}

/** Picks an option on a labelled level by the name it displays. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp | string,
  optionName: RegExp,
): Promise<void> {
  await user.selectOptions(levelControl(label), screen.getByRole('option', { name: optionName }));
}

/** A sibling consumer of the shared store, standing in for the app's shell. */
function ScopeReader() {
  const selection = useAtomValue(tenantSelectionAtom);
  const shown = [
    selection.organizationId ?? 'none',
    selection.workspaceId ?? 'none',
    selection.projectId ?? 'none',
  ].join(' / ');

  return <span data-testid="scope-reader">{shown}</span>;
}

describe('TenantSwitcher', () => {
  it('renders a labelled control for each level of the hierarchy', () => {
    renderSwitcher();

    expect(screen.getByTestId('tenant-switcher')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tenant scope' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Organization' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
  });

  it('opens on the initial selection passed in and persists nothing of its own', () => {
    renderSwitcher({
      initialSelection: { organizationId: 'org-1', workspaceId: 'ws-1' },
    });

    expect(chosen('Organization')).toBe('Northwind');
    expect(chosen('Workspace')).toBe('Platform');
    expect(chosen('Project')).toBe('All projects');
  });

  it('starts at the unscoped root when the host passes no selection', () => {
    renderSwitcher();

    expect(chosen('Organization')).toBe('All organizations');
    expect(chosen('Workspace')).toBe('All workspaces');
    expect(chosen('Project')).toBe('All projects');
  });

  it('narrows each level to the selection above it and reports the whole scope', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderSwitcher({ onChange });

    await pick(user, /Organization/, /Northwind/);
    await pick(user, /Workspace/, /Platform/);
    expect(onChange).toHaveBeenLastCalledWith({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      projectId: null,
    });

    await pick(user, /Project/, /Atlas/);
    expect(onChange).toHaveBeenLastCalledWith({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
    });

    // A cascade silently clears the levels below, so the scope is read back out.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Organization: Northwind, Workspace: Platform, Project: Atlas',
    );
  });

  it('offers only the children of the newly picked parent and clears the levels below', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderSwitcher({
      onChange,
      initialSelection: { organizationId: 'org-1', workspaceId: 'ws-1', projectId: 'proj-1' },
    });

    await pick(user, /Organization/, /Contoso/);

    // Changing the root resets the workspace and the project under it rather
    // than leaving a scope whose parent no longer matches.
    expect(onChange).toHaveBeenLastCalledWith({
      organizationId: 'org-2',
      workspaceId: null,
      projectId: null,
    });
    expect(chosen('Workspace')).toBe('All workspaces');
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeEnabled();
    expect(
      within(levelControl('Workspace'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All workspaces', 'Sales']);

    await pick(user, /Workspace/, /Sales/);
    await pick(user, /Project/, /Pipeline/);
    expect(onChange).toHaveBeenLastCalledWith({
      organizationId: 'org-2',
      workspaceId: 'ws-3',
      projectId: 'proj-3',
    });
  });

  it('keeps a level inert until its parent is chosen', () => {
    renderSwitcher();

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeDisabled();
    expect(screen.getByText('Select an organization to see its workspaces.')).toBeInTheDocument();
    expect(screen.getByText('Select a workspace to see its projects.')).toBeInTheDocument();
  });

  it('shows the empty level message when the chosen parent has no children', () => {
    renderSwitcher({
      organizations: [ORGANIZATIONS[0]],
      workspaces: [],
      initialSelection: { organizationId: 'org-1' },
    });

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDisabled();
    expect(
      screen.getByText('This organization has no workspaces you can access.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Select an organization to see its workspaces.')).toBeNull();
  });

  it('skeletons the first load and keeps every control inert while a read is in flight', () => {
    const { rerender } = renderSwitcher({ organizations: [], workspaces: [], status: 'loading' });

    const skeleton = screen.getByTestId('tenant-switcher-skeleton');
    expect(skeleton).toHaveTextContent('Loading organizations, workspaces and projects...');
    expect(screen.queryByRole('combobox', { name: 'Organization' })).toBeNull();

    // A refresh that already has organizations keeps them visible but inert.
    rerender(<TenantSwitcher {...directoryProps()} status="loading" />);
    expect(screen.queryByTestId('tenant-switcher-skeleton')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Organization' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeDisabled();
  });

  it('renders the empty state for an account with no organizations', () => {
    renderSwitcher({ organizations: [], workspaces: [], projects: [] });

    expect(screen.getByText('No organizations')).toBeInTheDocument();
    expect(screen.getByText('You are not a member of any organization yet.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Organization' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a load failure with the server detail and recovers through retry', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    const { rerender } = renderSwitcher({
      status: 'error',
      error: 'Tenant service unavailable',
      onRetry,
    });

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not load the tenant hierarchy')).toBeInTheDocument();
    expect(within(alert).getByText('Tenant service unavailable')).toBeInTheDocument();

    // A failed directory is inert: nothing may be picked from lists we distrust.
    expect(screen.getByRole('combobox', { name: 'Organization' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<TenantSwitcher {...directoryProps()} onRetry={onRetry} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Organization' })).toBeEnabled();
  });

  it('omits the retry affordance when the host has nothing to retry with', () => {
    renderSwitcher({ status: 'error', error: 'Boom' });

    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('clears the scope back to the unscoped root from the root level', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderSwitcher({
      onChange,
      initialSelection: { organizationId: 'org-1', workspaceId: 'ws-1', projectId: 'proj-1' },
    });

    await pick(user, /Organization/, /All organizations/);

    expect(onChange).toHaveBeenLastCalledWith({
      organizationId: null,
      workspaceId: null,
      projectId: null,
    });
    expect(chosen('Organization')).toBe('All organizations');
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDisabled();
  });

  it('drops a scope the refreshed directory can no longer honour', () => {
    renderSwitcher({
      organizations: [ORGANIZATIONS[0]],
      workspaces: [WORKSPACES[0]],
      initialSelection: { organizationId: 'org-2', workspaceId: 'ws-3' },
    });

    expect(chosen('Organization')).toBe('All organizations');
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDisabled();
  });

  it('seeds a host-provided store so sibling readers share the same scope', async () => {
    const user = userEvent.setup();
    const shared = createStore();

    render(
      <JotaiProvider store={shared}>
        <ScopeReader />
        <TenantSwitcher
          {...directoryProps()}
          store={shared}
          initialSelection={{ organizationId: 'org-1' }}
        />
      </JotaiProvider>,
    );

    // The remembered scope reaches the switcher and the sibling reader alike.
    expect(chosen('Organization')).toBe('Northwind');
    expect(screen.getByTestId('scope-reader')).toHaveTextContent('org-1 / none / none');

    await pick(user, /Workspace/, /Platform/);
    expect(screen.getByTestId('scope-reader')).toHaveTextContent('org-1 / ws-1 / none');
  });
});
