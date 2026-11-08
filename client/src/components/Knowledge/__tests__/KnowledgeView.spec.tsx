import { KnowledgeView } from '..';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { ToastContext, type TShowToast } from '@librechat/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import type { TKnowledgeCollection, TUser } from 'librechat-data-provider';
import { useKnowledgeCollectionsEnabledQuery } from '~/data-provider';
import { AuthContext } from '~/hooks';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      listKnowledgeCollections: jest.fn(),
      getKnowledgeCollection: jest.fn(),
      createKnowledgeCollection: jest.fn(),
      updateKnowledgeCollection: jest.fn(),
      deleteKnowledgeCollection: jest.fn(),
      addKnowledgeDocument: jest.fn(),
      retrieveKnowledge: jest.fn(),
    },
  };
});

const listCollections = dataService.listKnowledgeCollections as jest.MockedFunction<
  typeof dataService.listKnowledgeCollections
>;
const createCollection = dataService.createKnowledgeCollection as jest.MockedFunction<
  typeof dataService.createKnowledgeCollection
>;
const updateCollection = dataService.updateKnowledgeCollection as jest.MockedFunction<
  typeof dataService.updateKnowledgeCollection
>;
const deleteCollection = dataService.deleteKnowledgeCollection as jest.MockedFunction<
  typeof dataService.deleteKnowledgeCollection
>;

const makeCollection = (overrides: Partial<TKnowledgeCollection> = {}): TKnowledgeCollection => ({
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
  ...overrides,
});

const makeUser = (id: string, role: 'USER' | 'ADMIN' = 'USER'): TUser => ({
  id,
  username: id,
  email: `${id}@example.com`,
  name: id,
  avatar: '',
  role,
  provider: 'local',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const DISABLED_ERROR =
  'Retrieval is turned off on this server. Ask an administrator to enable it in the server configuration.';

/**
 * The options a cached query is actually running with.
 *
 * react-query 4 types `Query#options` as `QueryOptions`, which omits the
 * revalidation fields (`staleTime`, `refetchOnMount`, …) even though the observer
 * hands it a fully defaulted object, so the revalidation contract this test is
 * about is only reachable through a widened read.
 */
const runningOptions = (query: unknown): Record<string, unknown> =>
  (query as { options: Record<string, unknown> }).options;

const resolveList = (collections: TKnowledgeCollection[]) =>
  listCollections.mockResolvedValue({ collections });

/** The shell's half of the shared availability query: the sidebar rail mounts this
 *  to decide whether the Knowledge entry exists, and the page mounts the same hook
 *  to decide whether the page itself is usable. */
function ShellProbe() {
  useKnowledgeCollectionsEnabledQuery();
  return null;
}

/** The knowledge page at an arbitrary route, for the deep-link cases. */
const renderAt = (route: string, showToast: jest.Mock<void, [TShowToast]>) => {
  const queryClient = new QueryClient({
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  return render(
    <AuthContext.Provider
      value={{
        user: makeUser('user-1'),
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
          <JotaiProvider store={createStore()}>
            <MemoryRouter initialEntries={[route]}>
              <KnowledgeView />
            </MemoryRouter>
          </JotaiProvider>
        </QueryClientProvider>
      </ToastContext.Provider>
    </AuthContext.Provider>,
  );
};

const renderView = ({
  userId = 'user-1',
  role = 'USER',
  queryClient,
  shellProbe = false,
}: {
  userId?: string;
  role?: 'USER' | 'ADMIN';
  queryClient?: QueryClient;
  /** Mount a second observer of the availability probe, standing in for the
   *  sidebar rail that asks the same question while deciding whether the
   *  Knowledge entry exists. */
  shellProbe?: boolean;
} = {}) => {
  const showToast = jest.fn<void, [TShowToast]>();
  const store = createStore();
  const client =
    queryClient ??
    new QueryClient({
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      defaultOptions: {
        /** `retryDelay: 0` keeps the list query's own retry budget (3 attempts) from
         *  turning the failure test into a seven-second wait. */
        queries: { retry: false, retryDelay: 0 },
        mutations: { retry: false },
      },
    });
  const result = render(
    <AuthContext.Provider
      value={{
        user: makeUser(userId, role),
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
        <QueryClientProvider client={client}>
          <JotaiProvider store={store}>
            <MemoryRouter initialEntries={['/knowledge']}>
              {shellProbe ? <ShellProbe /> : null}
              <KnowledgeView />
            </MemoryRouter>
          </JotaiProvider>
        </QueryClientProvider>
      </ToastContext.Provider>
    </AuthContext.Provider>,
  );
  return { showToast, store, queryClient: client, ...result };
};

beforeEach(() => {
  listCollections.mockReset();
  createCollection.mockReset();
  updateCollection.mockReset();
  deleteCollection.mockReset();
});

describe('KnowledgeView', () => {
  it('renders one card per collection with the counts the server reported', async () => {
    resolveList([
      makeCollection({ id: 'collection-1', name: 'Handbook', description: 'Onboarding material' }),
      makeCollection({
        id: 'collection-2',
        name: 'Runbooks',
        description: undefined,
        scope: 'global',
        documentCount: 0,
        chunkCount: 0,
      }),
    ]);

    renderView();

    expect(await screen.findByText('Handbook')).toBeInTheDocument();
    expect(screen.getByText('Runbooks')).toBeInTheDocument();
    expect(screen.getByText('Onboarding material')).toBeInTheDocument();
    /** Counters come from the server response, never computed locally. */
    expect(screen.getByText('3 documents')).toBeInTheDocument();
    expect(screen.getByText('12 passages')).toBeInTheDocument();
    expect(screen.getByText('0 documents')).toBeInTheDocument();
    /** One scope chip per card, each naming the label and the scope itself. */
    expect(screen.getAllByText('Scope')).toHaveLength(2);
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('shows the empty state with a call to action when there are no collections', async () => {
    resolveList([]);

    renderView();

    expect(await screen.findByText('No collections yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Create a collection to group your documents, then add the content your assistants should retrieve.',
      ),
    ).toBeInTheDocument();
  });

  it('filters the rendered cards as the search field is typed into', async () => {
    resolveList([
      makeCollection({ id: 'collection-1', name: 'Handbook' }),
      makeCollection({ id: 'collection-2', name: 'Runbooks' }),
    ]);

    renderView();

    expect(await screen.findByText('Handbook')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search collections...' }), {
      target: { value: 'run' },
    });

    await waitFor(() => expect(screen.queryByText('Handbook')).not.toBeInTheDocument());
    expect(screen.getByText('Runbooks')).toBeInTheDocument();
  });

  it('says the filter matched nothing rather than claiming there are no collections', async () => {
    resolveList([makeCollection({ id: 'collection-1', name: 'Handbook' })]);

    renderView();

    expect(await screen.findByText('Handbook')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search collections...' }), {
      target: { value: 'nothing matches this' },
    });

    /** The list is not empty, so "No collections yet" here would tell the user to
     *  create a collection they already have. */
    expect(await screen.findByText('No matching collections')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No collection name or description contains that text. Clear the search to see all of them.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('No collections yet')).not.toBeInTheDocument();
  });

  it('renders the disabled state and hides creation when the server answers 503', async () => {
    listCollections.mockRejectedValue({ status: 503 });

    renderView();

    expect(await screen.findByText(DISABLED_ERROR)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New collection/i })).not.toBeInTheDocument();
    expect(screen.queryByText('No collections yet')).not.toBeInTheDocument();
  });

  it('disables the page when only the availability probe answers 503', async () => {
    /** The probe is the only signal `rag.disabled` exists, so a 503 from the probe
     *  alone has to hide the page: its collections load fine, but every action
     *  behind them would 503. Deriving the flag from one query missed exactly this. */
    let knowledgeDisabled = false;
    listCollections.mockImplementation(() =>
      knowledgeDisabled
        ? Promise.reject({ status: 503 })
        : Promise.resolve({ collections: [makeCollection({ name: 'Handbook' })] }),
    );

    const first = renderView();
    expect(await screen.findByText('Handbook')).toBeInTheDocument();
    first.unmount();

    knowledgeDisabled = true;
    renderView({ queryClient: first.queryClient });

    expect(await screen.findByText(DISABLED_ERROR)).toBeInTheDocument();
    expect(screen.queryByText('Handbook')).not.toBeInTheDocument();
  });

  it('revalidates the availability probe on mount instead of trusting a five-minute cache', async () => {
    resolveList([]);

    const { queryClient } = renderView();

    await screen.findByText('No collections yet');
    const probe = queryClient
      .getQueryCache()
      .find([QueryKeys.knowledgeCollections, 'availability']);
    expect(probe).toBeDefined();

    /** `rag.disabled` is an admin switch with no config flag or permission carrying
     *  it, so a cached answer is stale the moment it is flipped. */
    const options = runningOptions(probe);
    expect(options.staleTime).toBe(0);
    expect(options.refetchOnMount).toBe('always');
    expect(options.refetchOnWindowFocus).toBe(true);
    /** No polling: focus and mount are the only triggers, so there is no interval
     *  to storm with. */
    expect(options.refetchInterval).toBeFalsy();
    /** The page mounts the list and the probe, which is one request each and no
     *  more — revalidation is a revalidation, not a per-observer fetch. */
    expect(listCollections).toHaveBeenCalledTimes(2);
  });

  it('shares one availability query with the shell, so the observer count is not the request count', async () => {
    resolveList([]);

    const { queryClient } = renderView({ shellProbe: true });

    await screen.findByText('No collections yet');

    /** The sidebar rail mounts the same probe to decide whether the Knowledge
     *  entry exists at all, so on a knowledge route the shell and the page are
     *  both observers. Separate keys would mean a second `GET` on every arrival
     *  and two answers to the same admin switch that could disagree; one key
     *  means one in-flight request, deduplicated by react-query, and one verdict. */
    const availability = queryClient
      .getQueryCache()
      .findAll({ queryKey: [QueryKeys.knowledgeCollections, 'availability'] });
    expect(availability).toHaveLength(1);
    /** Two keys exactly: the list and the probe. A third would be a second probe. */
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: [QueryKeys.knowledgeCollections] })
        .map((query) => JSON.stringify(query.queryKey)),
    ).toEqual(
      expect.arrayContaining([
        JSON.stringify([QueryKeys.knowledgeCollections]),
        JSON.stringify([QueryKeys.knowledgeCollections, 'availability']),
      ]),
    );
    /** The page's own list plus the one shared probe, however many observers. */
    expect(listCollections).toHaveBeenCalledTimes(2);
  });

  it('invalidates the list alone, so a write does not re-probe the admin switch', async () => {
    resolveList([]);
    createCollection.mockResolvedValue(makeCollection({ id: 'collection-9', name: 'Policies' }));

    const { queryClient } = renderView({ role: 'ADMIN' });
    await screen.findByText('No collections yet');
    /** The page's list plus the shared availability probe. */
    expect(listCollections).toHaveBeenCalledTimes(2);

    /** The empty state's own call to action carries the same label; either opens
     *  the dialog. */
    fireEvent.click(screen.getAllByRole('button', { name: /New collection/i })[0] as HTMLElement);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Policies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));
    /** A prefix match on `[knowledgeCollections]` also reaches
     *  `[knowledgeCollections, 'availability']`, and the probe has an active
     *  observer here, so the old invalidation re-ran it: a third request per
     *  mutation asking again about a switch the mutation cannot have changed. */
    await waitFor(() => expect(listCollections).toHaveBeenCalledTimes(3));
    const probe = queryClient
      .getQueryCache()
      .find([QueryKeys.knowledgeCollections, 'availability']);
    expect(runningOptions(probe).isInvalidated).not.toBe(true);
  });

  it('surfaces a generic failure with a retry that refetches', async () => {
    listCollections.mockRejectedValueOnce({ status: 500 });

    renderView();

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(
      screen.getByText(
        'Something went wrong while talking to the knowledge store. Please try again.',
      ),
    ).toBeInTheDocument();

    listCollections.mockResolvedValue({ collections: [makeCollection({ name: 'Recovered' })] });
    fireEvent.click(retry);

    expect(await screen.findByText('Recovered')).toBeInTheDocument();
  });

  it('lets an admin create a global collection from the nav bar', async () => {
    resolveList([]);
    createCollection.mockResolvedValue(makeCollection({ id: 'collection-9', name: 'Policies' }));

    const { showToast } = renderView({ role: 'ADMIN' });

    fireEvent.click(await screen.findByRole('button', { name: /New collection/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith({ name: 'Policies', scope: 'global' }),
    );
    expect(showToast).toHaveBeenCalledWith({ message: 'Collection created', status: 'success' });
  });

  it('withholds the global scope from a non-admin in the create dialog', async () => {
    resolveList([]);
    createCollection.mockResolvedValue(makeCollection({ id: 'collection-9', name: 'Policies' }));

    renderView();

    fireEvent.click(await screen.findByRole('button', { name: /New collection/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Policies' } });

    /** The server 403s a non-admin creating a `global` collection, so the choice
     *  would have exactly one possible outcome. */
    expect(screen.queryByRole('radio', { name: 'Global' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));
    expect(createCollection).toHaveBeenCalledWith({ name: 'Policies', scope: 'private' });
  });

  it('opens the create dialog when the nav deep-links to ?new=1', async () => {
    resolveList([makeCollection({ name: 'Handbook' })]);
    createCollection.mockResolvedValue(makeCollection({ id: 'collection-9', name: 'Policies' }));

    const showToast = jest.fn<void, [TShowToast]>();
    const store = createStore();
    const queryClient = new QueryClient({
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
    });
    render(
      <AuthContext.Provider
        value={{
          user: makeUser('user-1'),
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
              <MemoryRouter initialEntries={['/knowledge?new=1']}>
                <KnowledgeView />
              </MemoryRouter>
            </JotaiProvider>
          </QueryClientProvider>
        </ToastContext.Provider>
      </AuthContext.Provider>,
    );

    /** The sidebar link is the only way into the feature from elsewhere in the
     *  app, so `?new=1` has a producer and the dialog opens on arrival. */
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  describe('a global collection owned by another user', () => {
    it('still renders the card, its scope and its counts, readably', async () => {
      resolveList([makeCollection({ name: 'Theirs', scope: 'global', userId: 'user-2' })]);

      renderView({ role: 'ADMIN' });

      /** Being unable to write is not being unable to read: the collection is in the
       *  list, it says what it is, and it opens. */
      const card = await screen.findByText('Theirs').then((node) => node.closest('article'));
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText('Global')).toBeInTheDocument();
      expect(within(card as HTMLElement).getByText('3 documents')).toBeInTheDocument();
    });

    it('offers the row menu on the owner’s own cards and withholds it elsewhere', async () => {
      resolveList([
        makeCollection({ id: 'collection-1', name: 'Mine', scope: 'global' }),
        makeCollection({ id: 'collection-2', name: 'Theirs', scope: 'global', userId: 'user-2' }),
        makeCollection({ id: 'collection-3', name: 'Also mine' }),
      ]);

      renderView();

      await screen.findByText('Mine');
      const mine = screen.getByText('Mine').closest('article');
      const theirs = screen.getByText('Theirs').closest('article');
      const alsoMine = screen.getByText('Also mine').closest('article');
      expect(mine).not.toBeNull();
      expect(theirs).not.toBeNull();
      expect(alsoMine).not.toBeNull();

      /** Edit and Delete both 403 for a non-owner, so the card that could only
       *  reach them loses its menu trigger rather than offering two dead actions. */
      expect(
        within(mine as HTMLElement).getByRole('button', { name: 'More options' }),
      ).toBeInTheDocument();
      expect(
        within(alsoMine as HTMLElement).getByRole('button', { name: 'More options' }),
      ).toBeInTheDocument();
      expect(
        within(theirs as HTMLElement).queryByRole('button', { name: 'More options' }),
      ).not.toBeInTheDocument();
    });
  });

  it('announces the state that replaced the page, not just the disabled one', async () => {
    resolveList([]);

    renderView();

    /** Every one of these branches swaps out everything the page was showing, so a
     *  screen reader told nothing about it is left with a `<main>` that went blank
     *  and no reason. The failure interrupts; the informational ones do not. */
    expect(await screen.findByRole('status')).toHaveTextContent('No collections yet');
  });

  it('announces a load failure, which is the one the user has to act on', async () => {
    listCollections.mockRejectedValue({ status: 500 });

    renderView();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong while talking to the knowledge store. Please try again.',
    );
  });

  it('announces the kill switch, because the whole page behind it is unusable', async () => {
    listCollections.mockRejectedValue({ status: 503 });

    renderView();

    expect(await screen.findByText(DISABLED_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(DISABLED_ERROR);
  });

  it('names the collections region, so the list is not an anonymous grid', async () => {
    resolveList([makeCollection({ name: 'Handbook' })]);

    renderView();

    expect(await screen.findByRole('region', { name: 'Collections' })).toBeInTheDocument();
  });

  it('offers the filter as a search box', async () => {
    resolveList([makeCollection({ name: 'Handbook' })]);

    renderView();

    /** `type="search"` is what gives it the role assistive tech keys off and the
     *  browser's own clear affordance — the only cheap way out of a term that
     *  filters every card away. */
    expect(
      await screen.findByRole('searchbox', { name: 'Search collections...' }),
    ).toBeInTheDocument();
  });

  it('starts each visit unfiltered, so a term typed once does not silently follow you back', async () => {
    resolveList([
      makeCollection({ name: 'Handbook' }),
      makeCollection({ id: 'c2', name: 'Policies' }),
    ]);

    const first = renderView();
    await screen.findByText('Handbook');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Policies' } });
    expect(screen.queryByText('Handbook')).not.toBeInTheDocument();
    first.unmount();

    /** The atom outlives the route, so a filter left behind came back with the
     *  next visit — with nothing in the URL and no hint that it had happened. */
    renderView({ queryClient: first.queryClient });
    expect(await screen.findByText('Handbook')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('will not open the create dialog from ?new=1 while the feature is off', async () => {
    listCollections.mockRejectedValue({ status: 503 });
    const showToast = jest.fn<void, [TShowToast]>();

    renderAt('/knowledge?new=1', showToast);

    expect(await screen.findByText(DISABLED_ERROR)).toBeInTheDocument();
    /** The parameter asks for a fully enabled create form over a page whose every
     *  request answers 503, and it would spring open later with no user action once
     *  an admin re-enabled the feature. */
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  });

  it('returns focus to the row menu that opened a card dialog', async () => {
    resolveList([makeCollection({ name: 'Handbook' })]);
    updateCollection.mockResolvedValue({ updated: true, collection: makeCollection() });

    renderView();

    const menu = await screen.findByRole('button', { name: 'More options' });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit collection' }));

    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    /** The menu item that opened the dialog is unmounted once the menu closes, so
     *  the dialog's own restore targeted a detached node and focus fell to
     *  `<body>` — the keyboard user was left at the top of the document. */
    await waitFor(() => expect(menu).toHaveFocus());
  });

  it('treats a 404 on delete as the outcome the user asked for', async () => {
    resolveList([makeCollection({ name: 'Handbook' })]);
    deleteCollection.mockRejectedValueOnce({ status: 404 });

    const { showToast } = renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'More options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete collection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: 'Collection deleted', status: 'success' }),
    );
  });
});
