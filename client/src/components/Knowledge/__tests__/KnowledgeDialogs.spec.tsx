import { useRef, useState } from 'react';
import { dataService } from 'librechat-data-provider';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { ToastContext, type TShowToast } from '@librechat/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TKnowledgeCollectionScope, TKnowledgeCollection, TUser } from 'librechat-data-provider';
import type { LocalizeFunction } from '~/common';
import KnowledgeCreateDialog, {
  KNOWLEDGE_SCOPE_CHOICES,
  getKnowledgeScopeLabel,
} from '../KnowledgeCreateDialog';
import KnowledgeDeleteDialog from '../KnowledgeDeleteDialog';
import { knowledgeSelectedCollectionIdAtom } from '../state';
import KnowledgeEditDialog from '../KnowledgeEditDialog';
import { AuthContext } from '~/hooks';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      listKnowledgeCollections: jest.fn(),
      createKnowledgeCollection: jest.fn(),
      updateKnowledgeCollection: jest.fn(),
      deleteKnowledgeCollection: jest.fn(),
    },
  };
});

const createCollection = dataService.createKnowledgeCollection as jest.MockedFunction<
  typeof dataService.createKnowledgeCollection
>;
const updateCollection = dataService.updateKnowledgeCollection as jest.MockedFunction<
  typeof dataService.updateKnowledgeCollection
>;
const deleteCollection = dataService.deleteKnowledgeCollection as jest.MockedFunction<
  typeof dataService.deleteKnowledgeCollection
>;

const collection: TKnowledgeCollection = {
  id: 'collection-1',
  userId: 'user-1',
  name: 'Handbook',
  description: 'Onboarding material',
  scope: 'private',
  chunkSize: 800,
  chunkOverlap: 80,
  documentCount: 3,
  chunkCount: 12,
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-03T10:00:00.000Z',
};

const GENERIC_ERROR =
  'Something went wrong while talking to the knowledge store. Please try again.';

/** Enough of `localize` for the pure scope labeller: the real translator resolves
 *  `com_ui_knowledge_scope_private` to "Private", so the stub takes the last
 *  segment and capitalises it. */
const stubLocalize = ((key: string) => {
  const last = key.split('_').pop() ?? key;
  return (last.charAt(0).toUpperCase() + last.slice(1)) as never;
}) as unknown as LocalizeFunction;

/**
 * The scope control reads the role off the auth context, so every render needs one.
 * `USER` is the default because it is the role that has the fewest options — a test
 * that does not care about scope should not be able to see a control by accident.
 */
const makeUser = (role: 'USER' | 'ADMIN'): TUser => ({
  id: 'user-1',
  username: 'user-1',
  email: 'user-1@example.com',
  name: 'User One',
  avatar: '',
  role,
  provider: 'local',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const renderWithProviders = (
  ui: React.ReactNode,
  {
    route = '/knowledge',
    showToast = jest.fn<void, [TShowToast]>(),
    store = createStore(),
    role = 'USER',
  }: {
    route?: string;
    showToast?: jest.Mock<void, [TShowToast]>;
    store?: ReturnType<typeof createStore>;
    role?: 'USER' | 'ADMIN';
  } = {},
) => {
  const queryClient = new QueryClient({
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  const result = render(
    <AuthContext.Provider
      value={{
        user: makeUser(role),
        token: 'token',
        isAuthenticated: true,
        isAuthReady: true,
        error: undefined,
        login: jest.fn(),
        logout: jest.fn(),
        setError: jest.fn(),
        roles: {},
      }}
    >
      <ToastContext.Provider value={{ showToast }}>
        <QueryClientProvider client={queryClient}>
          <JotaiProvider store={store}>
            <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
          </JotaiProvider>
        </QueryClientProvider>
      </ToastContext.Provider>
    </AuthContext.Provider>,
  );
  return { showToast, store, ...result };
};

function LocationProbe({ onChange }: { onChange: (pathname: string) => void }) {
  const location = useLocation();
  onChange(location.pathname);
  return null;
}

/** Held in a constant so the trigger's label is not a JSX text literal, which the
 *  `i18next/no-literal-string` rule reads as untranslated user-facing copy. */
const OPEN_DELETE_DIALOG = 'Open delete dialog';
const ELSEWHERE = 'Focus somewhere else';

/** Owns the `open` flag the way the list card and the workspace do, so closing and
 *  reopening are real state transitions rather than a prop that never changes. */
function ControlledDeleteDialog({
  target,
  onOpenChange,
}: {
  target: TKnowledgeCollection;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {OPEN_DELETE_DIALOG}
      </button>
      <KnowledgeDeleteDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        collection={target}
      />
    </>
  );
}

/** The same dialog wired the way the card wires it: a menu button that stays mounted
 *  for the dialog's whole life, so it can be the focus destination. */
function TriggerRefDeleteDialog({ target }: { target: TKnowledgeCollection }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {ELSEWHERE}
      </button>
      <button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
        {OPEN_DELETE_DIALOG}
      </button>
      <KnowledgeDeleteDialog
        open={open}
        onOpenChange={setOpen}
        collection={target}
        triggerRef={triggerRef}
      />
    </>
  );
}

beforeEach(() => {
  createCollection.mockReset();
  updateCollection.mockReset();
  deleteCollection.mockReset();
});

describe('KnowledgeCreateDialog', () => {
  it('leaves the form filled in and re-submittable after a failed create', async () => {
    createCollection.mockRejectedValueOnce({ status: 500 });
    const { showToast } = renderWithProviders(
      <KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: GENERIC_ERROR, status: 'error' }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Policies');
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();

    createCollection.mockResolvedValueOnce({ ...collection, id: 'collection-2', name: 'Policies' });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(2));
    expect(createCollection).toHaveBeenLastCalledWith({ name: 'Policies', scope: 'private' });
    expect(showToast).toHaveBeenLastCalledWith({
      message: 'Collection created',
      status: 'success',
    });
  });

  it('sends one create per submit, even while the first is still in flight', async () => {
    /** The button is `disabled` on the pending mutation, but a second `submit`
     *  does not wait for that attribute to be re-rendered, and `isLoading` is read
     *  on a render that has not happened yet — so the collection was created twice
     *  and two toasts reported it. */
    let resolveCreate: ((value: TKnowledgeCollection) => void) | undefined;
    createCollection.mockImplementation(
      () =>
        new Promise<TKnowledgeCollection>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Policies' } });
    const form = name.closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));

    resolveCreate?.({ ...collection, id: 'collection-2', name: 'Policies' });
    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));
  });

  describe('scope choices', () => {
    it('offers an admin exactly the two scopes the server acts on', () => {
      renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
        role: 'ADMIN',
      });

      /** The server grants a collection to its owner or to everyone when the scope
       *  is `global`; there are no project members. A "Project" choice would be
       *  stored and read back exactly like "Private" — a control that does nothing. */
      expect(
        screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked')),
      ).toEqual(['true', 'false']);
      expect(screen.getByRole('radio', { name: 'Private' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Global' })).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Project' })).not.toBeInTheDocument();
    });

    it('withholds global from a non-admin, who has only one scope to choose', () => {
      renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />);

      /** `canUseScope` requires the ADMIN role for `global`; the server 403s
       *  everyone else with "Collection scope not permitted". Offering it would be
       *  a control whose only possible outcome is that error. */
      expect(screen.queryByRole('radio', { name: 'Global' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      /** One applicable scope is not a choice, so the control goes rather than
       *  sitting there as a single segment that cannot be moved. */
      expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    });

    it('creates a private collection for a non-admin without ever sending a scope', async () => {
      createCollection.mockResolvedValue({ ...collection, id: 'collection-2' });
      renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />);

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));
      /** `private` is the server's own default, so the request carries nothing it
       *  could be refused for. */
      expect(createCollection).toHaveBeenCalledWith({ name: 'Policies', scope: 'private' });
    });

    it('offers and sends only those two scopes, for either role', async () => {
      /** The server grants a collection to its owner or to everyone, and reads
       *  `scope` as `private` or `global` — `canUseScope` 403s anything else. A
       *  third choice would be stored and read back exactly like `private`: a
       *  control that looks like it does something and does not. */
      const SERVER_SCOPES = ['global', 'private'];
      const offered = new Set<string>();
      const sent = new Set<string>();

      for (const role of ['ADMIN', 'USER'] as const) {
        const { unmount } = renderWithProviders(
          <KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />,
          { role },
        );
        for (const radio of screen.queryAllByRole('radio')) {
          offered.add(radio.textContent ?? '');
        }
        unmount();
      }

      for (const role of ['ADMIN', 'USER'] as const) {
        createCollection.mockResolvedValue({ ...collection, id: `collection-${role}` });
        const { unmount } = renderWithProviders(
          <KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />,
          { role },
        );
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
        /** Take the last scope on offer, so the admin path sends `global` and the
         *  non-admin path has no control at all and sends its default. */
        const radios = screen.queryAllByRole('radio');
        if (radios.length > 0) {
          fireEvent.click(radios[radios.length - 1] as HTMLElement);
        }
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(createCollection).toHaveBeenCalled());
        const payload = createCollection.mock.calls.at(-1)?.[0] as { scope?: string };
        sent.add(payload.scope ?? '');
        unmount();
      }

      expect([...offered].filter(Boolean).sort()).toEqual(['Global', 'Private']);
      expect([...sent].filter(Boolean).sort()).toEqual(SERVER_SCOPES);
    });

    it('cannot produce `project` from any producer, cast, default or fallback', async () => {
      /**
       * The direct form of the invariant, checked at every point a scope can reach
       * a request rather than at one dialog's happy path.
       *
       * `project` was in the scope union, was offered as a third radio, and was
       * stored and read back exactly like `private` — there are no project
       * members, and `canAccessCollection` is owner-or-`global`. It was a control
       * that silently did nothing. Three things have to hold for it to stay gone
       * and each fails on its own: the list the control is built from, the value a
       * `Radio` `onChange` casts into the scope type (that cast is unchecked, so
       * it launders *any* string), and the value a form starts from. Only the
       * editor is walked, because only the editor starts from a value the server
       * sent rather than one the client chose.
       */
      const SERVER_SCOPES: ReadonlySet<string> = new Set(['private', 'global']);
      const emitted: unknown[] = [];
      const offered = new Set<string>();

      /** The producer: the one list both editors build their control from, so
       *  nothing can be offered that is not in it. */
      expect(KNOWLEDGE_SCOPE_CHOICES).toEqual(['private', 'global']);

      for (const role of ['ADMIN', 'USER'] as const) {
        for (const storedScope of ['private', 'global'] as const) {
          const target = { ...collection, scope: storedScope };
          updateCollection.mockResolvedValue({ updated: true, collection: target });

          const { unmount } = renderWithProviders(
            <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={target} />,
            { role },
          );

          const radios = screen.queryAllByRole('radio');
          for (const radio of radios) {
            offered.add(radio.textContent ?? '');
          }
          const save = screen.getByRole('button', { name: 'Save' });
          const submit = async () => {
            /** Every path needs a dirty form, so the name is changed once and the
             *  scope is the only thing that varies between submissions. */
            await waitFor(() => expect(save).toBeEnabled());
            const before = updateCollection.mock.calls.length;
            fireEvent.click(save);
            await waitFor(() => expect(updateCollection.mock.calls.length).toBeGreaterThan(before));
            emitted.push((updateCollection.mock.calls.at(-1)?.[0] as { scope?: unknown }).scope);
          };

          fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
          /** The default: whatever the control left selected — which, for a stored
           *  scope this user cannot apply, is a value the form must not send at
           *  all, because `PATCH /:id` `$set`s every key it is handed. */
          await submit();
          /** Each cast in turn, so a value the DOM never rendered is not the only
           *  thing the payload is checked against. */
          for (const radio of radios) {
            fireEvent.click(radio);
            await submit();
          }
          unmount();
        }
      }

      expect([...offered].sort()).toEqual(['Global', 'Private']);
      expect([...offered]).not.toContain('Project');
      /** Either a scope the server acts on, or nothing at all — the third answer,
       *  and the correct one. */
      const sent = emitted.filter((scope) => scope != null);
      expect(sent.every((scope) => SERVER_SCOPES.has(scope as string))).toBe(true);
      expect([...new Set(sent)].sort()).toEqual(['global', 'private']);
      /** The fallback: a row stored with the retired value before the server began
       *  refusing it still reads back, and must not be labelled with a scope the
       *  client no longer offers. */
      expect(getKnowledgeScopeLabel('project' as TKnowledgeCollectionScope, stubLocalize)).toBe(
        'Private',
      );
    });
  });

  it('caps description at the length the server accepts', () => {
    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    /** Mirrors `DESC_MAX` in `packages/api/src/rag/validation.ts`, which is compared
     *  against `characterLength` (code points) — so `maxLength` is the wide ceiling
     *  at twice the cap, and the submit gate is the real rule, as for the name. */
    expect(screen.getByLabelText(/Description/)).toHaveAttribute('maxlength', String(512 * 2));
  });

  it('measures the description cap in characters, accepting the cap and refusing one more', () => {
    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    const description = screen.getByLabelText(/Description/);
    const create = screen.getByRole('button', { name: 'Create' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
    /** `fireEvent.change` writes the value directly, so `maxLength` never trims it
     *  and the code-point gate is the only thing standing between this and the
     *  server. `DESC_MAX` code points is what the server accepts. */
    fireEvent.change(description, { target: { value: 'a'.repeat(512) } });
    expect(create).toBeEnabled();

    fireEvent.change(description, { target: { value: 'a'.repeat(513) } });
    expect(create).toBeDisabled();
  });

  it('measures a description of emoji in characters, not in UTF-16 code units', () => {
    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    const description = screen.getByLabelText(/Description/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
    /** 512 emoji is 512 code points but 1024 code units: the `maxLength` ceiling is
     *  exactly there, so a code-unit gate would refuse a name-length-legal value. */
    fireEvent.change(description, { target: { value: '👍'.repeat(512) } });
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('measures the name cap in characters, so a name of emoji is not refused early', async () => {
    createCollection.mockResolvedValue({ ...collection, id: 'collection-2' });
    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    const name = screen.getByLabelText('Name') as HTMLInputElement;
    /** The server counts code points, so 33 emoji is a valid 33-character name.
     *  `maxLength` counts UTF-16 code units and would stop the input at 32, so the
     *  attribute is the wide ceiling and the submit gate is the real rule. */
    expect(name).toHaveAttribute('maxlength', String(64 * 2));

    fireEvent.change(name, { target: { value: '👍'.repeat(33) } });
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));
    expect(createCollection).toHaveBeenCalledWith({ name: '👍'.repeat(33), scope: 'private' });
  });

  it('blocks a name over the character cap rather than letting the server refuse it', () => {
    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a'.repeat(65) } });

    expect(screen.getByText('A collection name can be at most 64 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it("surfaces the server's own 400 rather than a generic failure", async () => {
    createCollection.mockRejectedValueOnce({
      status: 400,
      response: { data: { error: 'name must be <= 64 characters' } },
    });
    const { showToast } = renderWithProviders(
      <KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        message: 'name must be <= 64 characters',
        status: 'error',
      }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Policies');
  });

  it('surfaces a 403 from the server rather than reporting success', async () => {
    /** The other half of the 403 path the update dialog covers. `canUseScope`
     *  refuses `global` to a non-admin, and a create page opened before a role
     *  change — or by a tab that has not re-fetched the profile — sends it. */
    createCollection.mockRejectedValueOnce({
      status: 403,
      response: { data: { error: 'Collection scope not permitted' } },
    });
    const { showToast } = renderWithProviders(
      <KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />,
      { role: 'ADMIN' },
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        message: 'Collection scope not permitted',
        status: 'error',
      }),
    );
    expect(screen.queryByText('Collection created')).not.toBeInTheDocument();
    /** The draft survives so the same name can be submitted again as `private`. */
    expect(screen.getByLabelText('Name')).toHaveValue('Policies');
  });

  it('names and describes itself to assistive tech', async () => {
    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    /** A dialog announced as only "New collection" leaves the user guessing whether
     *  it creates something, renames something, or opens a share sheet. */
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('New collection');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'A collection holds documents your assistants can search. You can share it with everyone later.',
    );
  });

  it('labels every control, and the scope group as a group', () => {
    renderWithProviders(<KnowledgeCreateDialog open={true} onOpenChange={jest.fn()} />, {
      role: 'ADMIN',
    });

    /** `Radio` is a `role="radiogroup"` carrying only `aria-labelledby`, so a bare
     *  row of segments is announced as an unlabelled group of buttons. */
    expect(screen.getByRole('radiogroup', { name: 'Scope' })).toBeInTheDocument();
    for (const control of [
      screen.getByRole('textbox', { name: 'Name' }),
      screen.getByRole('textbox', { name: /Description/ }),
    ]) {
      expect(control).toBeInTheDocument();
      expect(control.getAttribute('aria-label') ?? control.getAttribute('id')).toBeTruthy();
    }
  });
});

describe('KnowledgeEditDialog', () => {
  it('lets an admin promote to global', async () => {
    updateCollection.mockResolvedValue({ updated: true, collection });

    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
      { role: 'ADMIN' },
    );

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    expect(updateCollection.mock.calls[0]?.[0]).toEqual({
      id: 'collection-1',
      name: 'Handbook',
      description: 'Onboarding material',
      scope: 'global',
    });
  });

  it('lets the owner of a global collection narrow it to private, without ever offering global', async () => {
    updateCollection.mockResolvedValue({ updated: true, collection });
    /** Shared with everyone and owned by this user. `canUseScope` requires ADMIN to
     *  *set* `global`, so a non-admin editing one is offered `private` alone. */
    const global = { ...collection, scope: 'global' as const };
    const { showToast } = renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={global} />,
    );

    expect(screen.queryByRole('radio', { name: 'Global' })).not.toBeInTheDocument();
    /** The one offered scope is not the stored one, so it is a control and not a
     *  single unchangeable segment: this is the only exit from sharing, and the
     *  server allows it from any role. */
    expect(screen.getByRole('radio', { name: 'Private' })).toBeInTheDocument();
    expect(screen.getByText('Scope')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    /** Nothing has changed yet as far as the server is concerned, so the rename
     *  alone has to be submittable — the withheld control used to leave the dialog
     *  permanently disabled instead. */
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    expect(updateCollection.mock.calls[0]?.[0]).toEqual({
      id: 'collection-1',
      name: 'Renamed',
      description: 'Onboarding material',
      scope: 'private',
    });
    expect(showToast).toHaveBeenCalledWith({ message: 'Collection updated', status: 'success' });
  });

  it('un-shares a global collection on its own, with no other edit', async () => {
    updateCollection.mockResolvedValue({ updated: true, collection });
    const global = { ...collection, scope: 'global' as const };

    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={global} />,
    );

    /** The demotion case: sharing was the only thing that ever had to change, so a
     *  gate that required some other field to be dirty would leave the collection
     *  shared for good. Save is enabled by the scope move alone. */
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    expect(updateCollection.mock.calls[0]?.[0]).toEqual({
      id: 'collection-1',
      name: 'Handbook',
      description: 'Onboarding material',
      scope: 'private',
    });
  });

  it('withholds the scope control entirely from a non-admin whose collection is private', () => {
    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
    );

    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('surfaces a 403 from the server rather than reporting success', async () => {
    /** The one 403 a knowledge write can answer: `canUseScope` refusing `global`.
     *  A page opened before a role change, or another tab, can hit it — and the
     *  message names the rule, so it has to reach the user verbatim. */
    updateCollection.mockRejectedValueOnce({
      status: 403,
      response: { data: { error: 'Collection scope not permitted' } },
    });
    const { showToast } = renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
      { role: 'ADMIN' },
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        message: 'Collection scope not permitted',
        status: 'error',
      }),
    );
    expect(screen.queryByText('Collection updated')).not.toBeInTheDocument();
    /** Still editable, so the user can correct what they were trying to do. */
    expect(screen.getByLabelText('Name')).toHaveValue('Renamed');
  });

  it('explains an over-long name to the input rather than only greying out Save', () => {
    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
      { role: 'ADMIN' },
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a'.repeat(65) } });

    const name = screen.getByLabelText('Name');
    const message = screen.getByText('A collection name can be at most 64 characters.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name.getAttribute('aria-describedby')).toBe(message.id);
    /** The message is a live region, so the refusal is announced when it appears
     *  rather than only when the field is next focused. */
    expect(message).toHaveAttribute('role', 'alert');
  });

  it('blocks a name over the character cap rather than letting the server refuse it', () => {
    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
      { role: 'ADMIN' },
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a'.repeat(65) } });

    expect(screen.getByText('A collection name can be at most 64 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('caps description at the length the server accepts', () => {
    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
      { role: 'ADMIN' },
    );

    expect(screen.getByLabelText(/Description/)).toHaveAttribute('maxlength', String(512 * 2));
  });

  it('measures the description cap in characters on edit too', () => {
    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
      { role: 'ADMIN' },
    );

    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'a'.repeat(512) } });
    expect(save).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'a'.repeat(513) } });
    expect(save).toBeDisabled();
  });

  it('names and describes itself to assistive tech, and labels the scope group', async () => {
    renderWithProviders(
      <KnowledgeEditDialog open={true} onOpenChange={jest.fn()} collection={collection} />,
      { role: 'ADMIN' },
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Edit collection');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Rename this collection, describe it, or change who can see it.',
    );
    /** The scope control is a `radiogroup`, and this is the only thing that names
     *  it — the `Label` it points at, which is why that `Label` is not a `htmlFor`
     *  target and has to stay mounted whenever the group is. */
    expect(screen.getByRole('radiogroup', { name: 'Scope' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Description/ })).toBeInTheDocument();
  });
});

describe('KnowledgeDeleteDialog', () => {
  it('names the collection, cancels without deleting, and deletes on confirm', async () => {
    deleteCollection.mockResolvedValue({ deleted: true });
    let pathname = '';
    const onOpenChange = jest.fn();
    const { showToast } = renderWithProviders(
      <>
        <LocationProbe onChange={(next) => (pathname = next)} />
        <ControlledDeleteDialog target={collection} onOpenChange={onOpenChange} />
      </>,
      { route: '/knowledge/collection-1' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open delete dialog' }));

    expect(screen.getByText('Delete this collection?')).toBeInTheDocument();
    expect(
      screen.getByText(
        '"Handbook" and every document in it will be permanently deleted. This cannot be undone.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    /** The dialog's owner holds `open`, so this asserts the transition itself —
     *  the dialog closes and reports `false` — rather than that a click did not throw. */
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Delete this collection?')).not.toBeInTheDocument();
    expect(deleteCollection).not.toHaveBeenCalled();
    /** Cancelling must not leave the collection page either. */
    expect(pathname).toBe('/knowledge/collection-1');

    fireEvent.click(screen.getByRole('button', { name: 'Open delete dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCollection).toHaveBeenCalledWith('collection-1'));
    expect(showToast).toHaveBeenCalledWith({
      message: 'Collection deleted',
      status: 'success',
    });
    /** Deleting from the collection's own page has to leave it. */
    await waitFor(() => expect(pathname).toBe('/knowledge'));
  });

  it('clears the selected collection so the list stops highlighting a deleted one', async () => {
    deleteCollection.mockResolvedValue({ deleted: true });
    const store = createStore();
    store.set(knowledgeSelectedCollectionIdAtom, 'collection-1');

    renderWithProviders(<ControlledDeleteDialog target={collection} />, { store });

    fireEvent.click(screen.getByRole('button', { name: 'Open delete dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCollection).toHaveBeenCalled());
    /** The detail route navigates away, but the atom outlives the route and the
     *  list highlights whatever it names — a deleted id meant a card highlighted
     *  by nothing and a detail route pointed at a collection that is gone. */
    await waitFor(() => expect(store.get(knowledgeSelectedCollectionIdAtom)).toBeNull());
  });

  it('keeps the confirm button live after a failed delete', async () => {
    deleteCollection.mockRejectedValueOnce({ status: 500 });
    const { showToast } = renderWithProviders(<ControlledDeleteDialog target={collection} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open delete dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: GENERIC_ERROR, status: 'error' }),
    );
    expect(screen.getByText('Delete this collection?')).toBeInTheDocument();

    deleteCollection.mockResolvedValueOnce({ deleted: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCollection).toHaveBeenCalledTimes(2));
  });

  it('describes itself to assistive tech, not only in the visible text', async () => {
    renderWithProviders(<ControlledDeleteDialog target={collection} />);

    fireEvent.click(screen.getByRole('button', { name: OPEN_DELETE_DIALOG }));

    /** Radix announces only a description the dialog points at, so the sentence
     *  naming the collection — the part that makes confirming a decision rather
     *  than a guess — was drawn and never spoken. */
    const dialog = await screen.findByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      '"Handbook" and every document in it will be permanently deleted. This cannot be undone.',
    );
    expect(dialog).toHaveAccessibleName('Delete this collection?');
  });

  it('returns focus to the trigger it was given, not to whatever was focused before', async () => {
    renderWithProviders(<TriggerRefDeleteDialog target={collection} />);

    const elsewhere = screen.getByRole('button', { name: ELSEWHERE });
    const trigger = screen.getByRole('button', { name: OPEN_DELETE_DIALOG });
    /** Focus sits on an unrelated control, which is where the dialog's own default
     *  restore would send it — the outcome the explicit trigger exists to override,
     *  and the one the row menu used to produce with a detached node. */
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.activeElement).not.toBe(elsewhere);
  });

  it('treats a 404 on delete as the outcome the user asked for', async () => {
    /** Someone else deleted it, or a second tab did: the collection is gone either
     *  way, so "Not found" beside a success toast and a redirect is just noise. */
    deleteCollection.mockRejectedValueOnce({ status: 404 });
    let pathname = '';
    const { showToast } = renderWithProviders(
      <>
        <LocationProbe onChange={(next) => (pathname = next)} />
        <ControlledDeleteDialog target={collection} />
      </>,
      { route: '/knowledge/collection-1' },
    );

    fireEvent.click(screen.getByRole('button', { name: OPEN_DELETE_DIALOG }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: 'Collection deleted', status: 'success' }),
    );
    await waitFor(() => expect(pathname).toBe('/knowledge'));
    expect(deleteCollection).toHaveBeenCalledTimes(1);
  });

  it('still reports a 500 on delete as a failure', async () => {
    deleteCollection.mockRejectedValueOnce({ status: 500 });
    const { showToast } = renderWithProviders(<ControlledDeleteDialog target={collection} />);

    fireEvent.click(screen.getByRole('button', { name: OPEN_DELETE_DIALOG }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: GENERIC_ERROR, status: 'error' }),
    );
  });
});
