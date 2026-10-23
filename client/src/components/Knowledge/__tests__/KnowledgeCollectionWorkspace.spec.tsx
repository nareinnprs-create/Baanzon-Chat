import { KnowledgeCollectionWorkspace } from '..';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { ToastContext, type TShowToast } from '@librechat/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import type { TKnowledgeCollection, TKnowledgeSnippet, TUser } from 'librechat-data-provider';
import { AuthContext } from '~/hooks';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      listKnowledgeCollections: jest.fn(),
      getKnowledgeCollection: jest.fn(),
      addKnowledgeDocument: jest.fn(),
      deleteKnowledgeDocument: jest.fn(),
      retrieveKnowledge: jest.fn(),
    },
  };
});

const getCollection = dataService.getKnowledgeCollection as jest.MockedFunction<
  typeof dataService.getKnowledgeCollection
>;
const listCollections = dataService.listKnowledgeCollections as jest.MockedFunction<
  typeof dataService.listKnowledgeCollections
>;
const addDocument = dataService.addKnowledgeDocument as jest.MockedFunction<
  typeof dataService.addKnowledgeDocument
>;
const deleteDocument = dataService.deleteKnowledgeDocument as jest.MockedFunction<
  typeof dataService.deleteKnowledgeDocument
>;
const retrieveKnowledge = dataService.retrieveKnowledge as jest.MockedFunction<
  typeof dataService.retrieveKnowledge
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
const DISABLED_ERROR =
  'Retrieval is turned off on this server. Ask an administrator to enable it in the server configuration.';
const SESSION_HINT =
  'Documents you add in this session are listed here. The API cannot list them back, so these rows disappear on reload — the totals above still count them.';
const SESSION_HEADING = 'Documents added this session';
const READ_ONLY_NOTICE =
  'This collection is shared with everyone, so you can search and test retrieval here. Only its owner can rename it, add documents or delete it.';
const CAPACITY_ERROR =
  "This server's knowledge storage is full, so no more text can be indexed. Ask an administrator to free space or raise the configured limit.";
const NOT_FOUND_ERROR =
  'This collection no longer exists. It was probably deleted in another tab or by an administrator.';

const makeSnippet = (overrides: Partial<TKnowledgeSnippet> = {}): TKnowledgeSnippet => ({
  collectionId: 'collection-1',
  documentId: 'document-1',
  chunkIndex: 0,
  text: 'Expenses are reimbursed within thirty days.',
  score: 0.9123,
  source: 'hybrid',
  ...overrides,
});

/** The signed-in user. A collection owned by anyone else is read-only. */
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

const renderWorkspace = ({
  collectionId = 'collection-1',
  userId = 'user-1',
  role = 'USER',
  queryClient,
}: {
  collectionId?: string;
  userId?: string;
  role?: 'USER' | 'ADMIN';
  queryClient?: QueryClient;
} = {}) => {
  const showToast = jest.fn<void, [TShowToast]>();
  const store = createStore();
  const client =
    queryClient ??
    new QueryClient({
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      defaultOptions: {
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
            <MemoryRouter initialEntries={[`/knowledge/${collectionId}`]}>
              <Routes>
                <Route path="/knowledge/:collectionId" element={<KnowledgeCollectionWorkspace />} />
              </Routes>
            </MemoryRouter>
          </JotaiProvider>
        </QueryClientProvider>
      </ToastContext.Provider>
    </AuthContext.Provider>,
  );
  return { showToast, store, queryClient: client, ...result };
};

beforeEach(() => {
  getCollection.mockReset();
  listCollections.mockReset();
  addDocument.mockReset();
  deleteDocument.mockReset();
  retrieveKnowledge.mockReset();
  /** No capacity reported, which is what `InMemoryVectorStore` answers — the store
   *  that raises the 409 in the first place. Every test that does not say
   *  otherwise therefore has nothing rendered by the capacity line. */
  listCollections.mockResolvedValue({ collections: [collection] });
});

/** The session log is a labelled region, so scoping is by its heading. The heading
 *  is a name; the sentence explaining why the list empties on reload is body copy
 *  beside it, not the region's name. */
const getSessionList = () => screen.getByRole('region', { name: SESSION_HEADING });

const ingest = async (content: string, source?: string) => {
  fireEvent.change(await screen.findByLabelText('Content'), { target: { value: content } });
  if (source) {
    fireEvent.change(screen.getByLabelText(/Source/), { target: { value: source } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
};

describe('KnowledgeCollectionWorkspace', () => {
  it('renders the collection with the server counters as the only totals', async () => {
    getCollection.mockResolvedValue({ collection });

    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Handbook' })).toBeInTheDocument();
    expect(screen.getByText('Onboarding material')).toBeInTheDocument();
    expect(screen.getAllByText('3 documents').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12 passages').length).toBeGreaterThan(0);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Last updated')).toBeInTheDocument();
    /** The stat line used to read "Documents 3 documents" — a label restating the
     *  count's own label. The count carries the noun now. */
    expect(screen.queryByText('Documents', { exact: true })).not.toBeInTheDocument();
  });

  it('singularises a collection of one', async () => {
    getCollection.mockResolvedValue({
      collection: { ...collection, documentCount: 1, chunkCount: 1 },
    });

    renderWorkspace();

    await screen.findByRole('heading', { name: 'Handbook' });
    /** Both the header stat line and the ingest panel carry the counts, so this
     *  is a "the singular form exists" assertion rather than a single-node one. */
    expect(screen.getAllByText('1 document').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 passage').length).toBeGreaterThan(0);
    expect(screen.queryByText('1 documents')).not.toBeInTheDocument();
    expect(screen.queryByText('1 passages')).not.toBeInTheDocument();
  });

  it('gives each collection its own cache entry, so two never share data', async () => {
    getCollection.mockImplementation(async (id: string) => ({
      collection: { ...collection, id, name: `Handbook ${id}` },
    }));

    const first = renderWorkspace({ collectionId: 'collection-1' });
    expect(
      await screen.findByRole('heading', { name: 'Handbook collection-1' }),
    ).toBeInTheDocument();
    first.unmount();

    /** A key missing the id would hand this page collection-1's cached
     *  `{ collection }` envelope and render the wrong name without a request. */
    renderWorkspace({ collectionId: 'collection-2', queryClient: first.queryClient });

    expect(
      await screen.findByRole('heading', { name: 'Handbook collection-2' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Handbook collection-1' }),
    ).not.toBeInTheDocument();
    expect(getCollection).toHaveBeenCalledWith('collection-1');
    expect(getCollection).toHaveBeenCalledWith('collection-2');

    const detailKeys = first.queryClient
      .getQueryCache()
      .findAll({ queryKey: [QueryKeys.knowledgeCollection] })
      .map((query) => query.queryKey);
    expect(detailKeys).toEqual([
      [QueryKeys.knowledgeCollection, 'collection-1'],
      [QueryKeys.knowledgeCollection, 'collection-2'],
    ]);
  });

  it('renders the disabled state when the collection request answers 503', async () => {
    getCollection.mockRejectedValue({ status: 503 });

    renderWorkspace();

    expect(await screen.findByText(DISABLED_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to collections/i })).toBeInTheDocument();
  });

  it('says the collection is gone for a 404, rather than blaming the server', async () => {
    /** Someone deleted it in another tab, or an administrator did, and the page the
     *  user is sitting on refetched. "Something went wrong" is a server fault and
     *  nothing failed: the thing this page is about is gone, and the only useful
     *  next step is back to the list — which the state offers. */
    getCollection.mockRejectedValue({
      status: 404,
      response: { data: { error: 'Not Found' } },
    });

    renderWorkspace();

    expect(await screen.findByText(NOT_FOUND_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
    /** Announced, like the other page-level states, and actionable. */
    expect(screen.getByRole('alert')).toHaveTextContent(NOT_FOUND_ERROR);
    expect(screen.getByRole('button', { name: /Back to collections/i })).toBeInTheDocument();
  });

  it('asks for a label on the source field, not for a file or a link', async () => {
    getCollection.mockResolvedValue({ collection });

    renderWorkspace();

    /** `source` is a free-text label the server stores verbatim and the session
     *  log shows back. Nothing is fetched from it and nothing links to it, so a
     *  placeholder that reads like a filename or a URL promises a capability the
     *  field does not have — and invites a user to paste a path that will never
     *  resolve to anything. */
    expect(
      await screen.findByPlaceholderText(
        'Optional: a short label for this text, e.g. Expenses policy',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Source/)).not.toHaveAttribute('type', 'file');
  });

  it('keeps the ingest form filled in and re-submittable after a failed ingest', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockRejectedValueOnce({ status: 500 });

    const { showToast } = renderWorkspace();

    const contentField = await screen.findByLabelText('Content');
    fireEvent.change(contentField, { target: { value: 'Expenses are reimbursed monthly.' } });
    fireEvent.change(screen.getByLabelText(/Source/), {
      target: { value: 'onboarding-handbook.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: GENERIC_ERROR, status: 'error' }),
    );
    expect(screen.getByLabelText('Content')).toHaveValue('Expenses are reimbursed monthly.');
    expect(screen.getByRole('button', { name: 'Add document' })).toBeEnabled();

    addDocument.mockResolvedValueOnce({ documentId: 'document-2', chunkCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));

    await waitFor(() => expect(addDocument).toHaveBeenCalledTimes(2));
    expect(addDocument).toHaveBeenLastCalledWith('collection-1', {
      content: 'Expenses are reimbursed monthly.',
      source: 'onboarding-handbook.pdf',
    });
    expect(showToast).toHaveBeenLastCalledWith({
      message: 'Added 3 passages from this document',
      status: 'success',
    });
    /** A successful ingest clears the draft; the counters come back from the server. */
    await waitFor(() => expect(screen.getByLabelText('Content')).toHaveValue(''));
  });

  it("surfaces the server's own 400 rather than a generic failure", async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockRejectedValueOnce({
      status: 400,
      response: { data: { error: 'content must be <= 400000 characters' } },
    });

    const { showToast } = renderWorkspace();

    await ingest('Expenses are reimbursed monthly.');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        message: 'content must be <= 400000 characters',
        status: 'error',
      }),
    );
    /** The draft survives so the same text can be shortened and resubmitted. */
    expect(screen.getByLabelText('Content')).toHaveValue('Expenses are reimbursed monthly.');
  });

  it('caps the ingest and query fields at the lengths the server accepts', async () => {
    getCollection.mockResolvedValue({ collection });

    renderWorkspace();

    const content = await screen.findByLabelText('Content');
    /** Mirrors `CONTENT_MAX` / `QUERY_MAX` in `packages/api/src/rag/validation.ts`.
     *  `content` is counted in code units there, so `maxLength` is its exact cap;
     *  `query` is counted in code points, so its is the wide ceiling. */
    expect(content).toHaveAttribute('maxlength', '400000');
    expect(screen.getByLabelText('Query')).toHaveAttribute('maxlength', String(2000 * 2));
    /** `source` is an unvalidated free-text label — the server stores it as given. */
    expect(screen.getByLabelText(/Source/)).not.toHaveAttribute('maxlength');

    expect(screen.getByText('0 / 400000 characters')).toBeInTheDocument();
    fireEvent.change(content, { target: { value: 'Expenses' } });
    expect(screen.getByText('8 / 400000 characters')).toBeInTheDocument();
  });

  it('never lets an over-long document reach the server', async () => {
    getCollection.mockResolvedValue({ collection });

    renderWorkspace();

    const content = await screen.findByLabelText('Content');
    const overMax = 'x'.repeat(400_001);
    fireEvent.change(content, { target: { value: overMax } });

    /** `maxLength` is not the mechanism — a paste that exceeds it is still truncated by
     *  the browser, so the count and the disabled button are what make the cap real. The
     *  live count is what tells the user which of the two happened. */
    expect(content).toHaveValue(overMax);
    expect(screen.getByText(`400001 / 400000 characters`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add document' })).toBeDisabled();

    fireEvent.change(content, { target: { value: 'x'.repeat(400_000) } });
    expect(screen.getByRole('button', { name: 'Add document' })).toBeEnabled();
    expect(addDocument).not.toHaveBeenCalled();
  });

  it('lists an ingested document with its source and chunk count', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-7', chunkCount: 4 });

    renderWorkspace();

    await ingest('Expenses are reimbursed monthly.', 'onboarding-handbook.pdf');

    const sessionList = await waitFor(() => {
      const rows = within(getSessionList()).getAllByRole('listitem');
      expect(rows).toHaveLength(1);
      return rows;
    });
    expect(sessionList[0]).toHaveTextContent('onboarding-handbook.pdf');
    expect(sessionList[0]).toHaveTextContent('Expenses are reimbursed monthly.');
    expect(sessionList[0]).toHaveTextContent('4 passages');
    expect(
      within(getSessionList()).getByRole('button', { name: 'Delete: onboarding-handbook.pdf' }),
    ).toBeInTheDocument();
  });

  it('falls back to a text preview when the document has no source', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-8', chunkCount: 1 });

    renderWorkspace();

    await ingest('Expenses are reimbursed monthly.');

    await waitFor(() =>
      expect(
        within(getSessionList()).getByText('Expenses are reimbursed monthly.'),
      ).toBeInTheDocument(),
    );
  });

  it('confirms before deleting and drops the row once the mutation succeeds', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-7', chunkCount: 4 });
    deleteDocument.mockResolvedValue({ deleted: true });

    const { showToast } = renderWorkspace();

    await ingest('Expenses are reimbursed monthly.', 'onboarding-handbook.pdf');
    await waitFor(() => expect(addDocument).toHaveBeenCalled());

    fireEvent.click(
      within(getSessionList()).getByRole('button', { name: 'Delete: onboarding-handbook.pdf' }),
    );

    /** The row arms a confirm pair rather than deleting on the first click. */
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(within(getSessionList()).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(within(getSessionList()).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith('collection-1', 'document-7'));
    expect(showToast).toHaveBeenCalledWith({ message: 'Document deleted', status: 'success' });
    await waitFor(() =>
      expect(within(getSessionList()).queryAllByRole('listitem')).toHaveLength(0),
    );
  });

  it('keeps the row and re-arms it after a failed delete', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-7', chunkCount: 4 });
    deleteDocument.mockRejectedValueOnce({ status: 500 });

    const { showToast } = renderWorkspace();

    await ingest('Expenses are reimbursed monthly.', 'onboarding-handbook.pdf');
    await waitFor(() => expect(addDocument).toHaveBeenCalled());

    fireEvent.click(
      within(getSessionList()).getByRole('button', { name: 'Delete: onboarding-handbook.pdf' }),
    );
    fireEvent.click(within(getSessionList()).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: GENERIC_ERROR, status: 'error' }),
    );
    expect(within(getSessionList()).getAllByRole('listitem')).toHaveLength(1);
    /** Still armed, so the same attempt can simply be repeated. */
    expect(within(getSessionList()).getByRole('button', { name: 'Delete' })).toBeEnabled();

    deleteDocument.mockResolvedValueOnce({ deleted: true });
    fireEvent.click(within(getSessionList()).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(getSessionList()).queryAllByRole('listitem')).toHaveLength(0),
    );
  });

  it('shows the session-only disclosure and no rows on a fresh mount', async () => {
    getCollection.mockResolvedValue({ collection });

    renderWorkspace();

    await screen.findByRole('heading', { name: 'Handbook' });
    const sessionList = getSessionList();
    expect(screen.getByText(SESSION_HINT)).toBeInTheDocument();
    expect(within(sessionList).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(sessionList).queryByRole('button', { name: /^Delete:/ })).toBeNull();
  });

  it('records nothing in the session list when the ingest itself failed', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockRejectedValueOnce({ status: 500 });

    renderWorkspace();

    await ingest('Expenses are reimbursed monthly.', 'onboarding-handbook.pdf');

    await waitFor(() => expect(addDocument).toHaveBeenCalled());
    expect(within(getSessionList()).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('reports a 503 ingest as the feature being off, not a generic failure', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockRejectedValueOnce({ status: 503 });

    const { showToast } = renderWorkspace();

    fireEvent.change(await screen.findByLabelText('Content'), {
      target: { value: 'Expenses are reimbursed monthly.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: DISABLED_ERROR, status: 'error' }),
    );
  });

  it('lists the passages a test query retrieves, and reports an empty result', async () => {
    getCollection.mockResolvedValue({ collection });
    retrieveKnowledge.mockResolvedValueOnce({ snippets: [makeSnippet()] });
    retrieveKnowledge.mockResolvedValueOnce({ snippets: [] });

    renderWorkspace();

    fireEvent.change(await screen.findByLabelText('Query'), {
      target: { value: 'How long do I have to claim expenses?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }));

    expect(
      await screen.findByText('Expenses are reimbursed within thirty days.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Score: 0.912')).toBeInTheDocument();
    expect(retrieveKnowledge).toHaveBeenCalledWith('collection-1', {
      collectionId: 'collection-1',
      query: 'How long do I have to claim expenses?',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run query' }));

    expect(await screen.findByText('No matching passages')).toBeInTheDocument();
  });

  it('keeps the test query after a failed run so it can be retried', async () => {
    getCollection.mockResolvedValue({ collection });
    retrieveKnowledge.mockRejectedValueOnce({ status: 500 });

    const { showToast } = renderWorkspace();

    const queryField = await screen.findByLabelText('Query');
    fireEvent.change(queryField, { target: { value: 'How long do I have to claim expenses?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: GENERIC_ERROR, status: 'error' }),
    );
    expect(screen.getByLabelText('Query')).toHaveValue('How long do I have to claim expenses?');
    expect(screen.getByRole('button', { name: 'Run query' })).toBeEnabled();
  });

  describe('a global collection owned by another user', () => {
    const foreignGlobal = { ...collection, scope: 'global', userId: 'user-2' } as const;

    it('withholds the write controls and leaves retrieval working', async () => {
      getCollection.mockResolvedValue({ collection: foreignGlobal });
      retrieveKnowledge.mockResolvedValue({ snippets: [makeSnippet()] });

      renderWorkspace({ userId: 'user-1' });

      await screen.findByRole('heading', { name: 'Handbook' });
      /** Every one of these answers 403 for a non-owner: the server's
       *  `canWriteCollection` is `collection.userId === userId` and nothing else. */
      expect(screen.queryByRole('button', { name: 'Edit collection' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete collection' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Content')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add document' })).not.toBeInTheDocument();
      /** The session log exists to delete what this browser ingested, and it cannot
       *  ingest here, so it is withheld too. */
      expect(screen.queryByRole('region', { name: SESSION_HEADING })).not.toBeInTheDocument();
      /** Absence of controls is not an explanation: a shared collection is fully
       *  usable for retrieval, and the user is otherwise left guessing whether the
       *  buttons are broken or they are looking at the wrong thing. */
      expect(screen.getByText(READ_ONLY_NOTICE)).toBeInTheDocument();

      /** Readable, so retrieval stays: this is the one action that can succeed. */
      fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'expenses?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Run query' }));

      await waitFor(() => expect(retrieveKnowledge).toHaveBeenCalledTimes(1));
      expect(
        await screen.findByText('Expenses are reimbursed within thirty days.'),
      ).toBeInTheDocument();
    });

    it('keeps the write controls for the owner of the same global collection', async () => {
      getCollection.mockResolvedValue({ collection: foreignGlobal });

      renderWorkspace({ userId: 'user-2' });

      await screen.findByRole('heading', { name: 'Handbook' });
      expect(screen.getByRole('button', { name: 'Edit collection' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete collection' })).toBeInTheDocument();
      expect(screen.getByLabelText('Content')).toBeInTheDocument();
    });
  });

  it('names the session log after what it is, and keeps the disclosure as body copy', async () => {
    getCollection.mockResolvedValue({ collection });

    renderWorkspace();

    await screen.findByRole('heading', { name: 'Handbook' });
    /** A four-line sentence was the name of the region and the region itself was
     *  nameless, so a screen reader announced the explanation where the user
     *  needed the name and nothing where they needed the explanation. */
    const region = getSessionList();
    expect(region).toHaveAccessibleName(SESSION_HEADING);
    expect(within(region).getByText(SESSION_HINT)).toBeInTheDocument();
    expect(within(region).getByRole('heading', { name: SESSION_HEADING })).toBeInTheDocument();
  });

  it('gives focus to Cancel when a row arms, and to the heading when the row goes', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-7', chunkCount: 4 });
    deleteDocument.mockResolvedValue({ deleted: true });

    renderWorkspace();

    await ingest('Expenses are reimbursed monthly.', 'onboarding-handbook.pdf');
    await waitFor(() => expect(addDocument).toHaveBeenCalled());

    const trash = within(getSessionList()).getByRole('button', {
      name: 'Delete: onboarding-handbook.pdf',
    });
    trash.focus();
    fireEvent.click(trash);

    /** The confirm pair replaces the button that had focus. Left alone, focus falls
     *  on `<body>` and the next Enter — the reflexive retry — lands nowhere; parked
     *  on the destructive half it would be a second delete. */
    await waitFor(() =>
      expect(within(getSessionList()).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    );

    fireEvent.click(within(getSessionList()).getByRole('button', { name: 'Delete' }));

    /** The row is unmounted on success, so the nearest surviving target is the
     *  region heading rather than a button that no longer exists. */
    await waitFor(() =>
      expect(
        within(getSessionList()).getByRole('heading', { name: SESSION_HEADING }),
      ).toHaveFocus(),
    );
  });

  it('returns focus to the row that was being deleted when the confirm is cancelled', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-7', chunkCount: 4 });
    deleteDocument.mockResolvedValue({ deleted: true });

    renderWorkspace();

    await ingest('Expenses are reimbursed monthly.', 'onboarding-handbook.pdf');
    await waitFor(() => expect(addDocument).toHaveBeenCalled());

    fireEvent.click(
      within(getSessionList()).getByRole('button', { name: 'Delete: onboarding-handbook.pdf' }),
    );
    fireEvent.click(within(getSessionList()).getByRole('button', { name: 'Cancel' }));

    /** The row is still there, so focus goes back to the control that opened the
     *  confirm instead of the heading — the user never left the row. */
    await waitFor(() =>
      expect(
        within(getSessionList()).getByRole('button', { name: 'Delete: onboarding-handbook.pdf' }),
      ).toHaveFocus(),
    );
  });

  it('drops the row when the server says the document is already gone', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-7', chunkCount: 4 });
    deleteDocument.mockRejectedValueOnce({ status: 404 });

    const { showToast } = renderWorkspace();

    await ingest('Expenses are reimbursed monthly.', 'onboarding-handbook.pdf');
    await waitFor(() => expect(addDocument).toHaveBeenCalled());

    fireEvent.click(
      within(getSessionList()).getByRole('button', { name: 'Delete: onboarding-handbook.pdf' }),
    );
    fireEvent.click(within(getSessionList()).getByRole('button', { name: 'Delete' }));

    /** The document is gone either way — a reload would drop the row — so this is
     *  the outcome that was asked for, and reporting "Not found" beside a session
     *  row that is still on screen would be both alarming and wrong. */
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: 'Document deleted', status: 'success' }),
    );
    await waitFor(() =>
      expect(within(getSessionList()).queryAllByRole('listitem')).toHaveLength(0),
    );
  });

  it('explains a full store in the user’s terms instead of passing the server’s text on', async () => {
    getCollection.mockResolvedValue({ collection });
    /** `packages/api/src/rag/errors.ts` answers 409 with the store's own wording,
     *  which names a config key and an option no user of the app can see. */
    addDocument.mockRejectedValueOnce({
      status: 409,
      response: {
        data: {
          error:
            'In-memory vector store is full (20000 chunks); configure a persistent vector store or raise inMemoryMaxChunks',
        },
      },
    });

    const { showToast } = renderWorkspace();

    await ingest('Expenses are reimbursed monthly.');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: CAPACITY_ERROR, status: 'error' }),
    );
    expect(JSON.stringify(showToast.mock.calls)).not.toContain('inMemoryMaxChunks');
    /** Refusable by shortening: the draft survives. */
    expect(screen.getByLabelText('Content')).toHaveValue('Expenses are reimbursed monthly.');
  });

  it('says how much room the index has left before a paste is refused for it', async () => {
    getCollection.mockResolvedValue({ collection });
    /** A persistent store reports its usage on the list route, which is the only
     *  route that does. Capacity exhaustion is deployment-wide and permanent, so
     *  the point of showing it is to arrive before the 409 rather than explain it
     *  afterwards — the numbers above the form say how much is indexed, and this
     *  is the other half: how much more can be. */
    listCollections.mockResolvedValue({
      collections: [collection],
      capacity: { remainingChunks: 12_400, remainingCollections: 180 },
    });

    renderWorkspace();

    expect(
      await screen.findByText("12400 passages of room left in this server's index"),
    ).toBeInTheDocument();
  });

  it('warns in the form itself once the index has no room at all', async () => {
    getCollection.mockResolvedValue({ collection });
    listCollections.mockResolvedValue({
      collections: [collection],
      capacity: { remainingChunks: 0, remainingCollections: 180 },
    });

    renderWorkspace();

    /** Zero is not the same answer as `null`, and the difference is the whole
     *  message: `null` is a store that does not report (nothing is drawn), zero
     *  is a store that will refuse the next ingest whatever is pasted into it. */
    expect(
      await screen.findByText(
        "This server's knowledge index is full, so nothing more can be indexed. Ask an administrator to free space or raise the configured limit.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/room left/)).not.toBeInTheDocument();
  });

  it('says nothing about capacity when the store does not report it', async () => {
    getCollection.mockResolvedValue({ collection });
    listCollections.mockResolvedValue({ collections: [collection], capacity: null });

    renderWorkspace();

    await screen.findByLabelText('Content');
    /** The default store is one of these, and it is the store that raises the
     *  409. An "unknown" would be indistinguishable from a store that is silently
     *  failing, so there is nothing to draw and the 409 stands alone. */
    expect(screen.queryByText(/room left/)).not.toBeInTheDocument();
    expect(screen.queryByText(/index is full/)).not.toBeInTheDocument();
  });

  it('singularises a document that produced one passage', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-9', chunkCount: 1 });

    const { showToast } = renderWorkspace();

    await ingest('Expenses are reimbursed monthly.');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        message: 'Added 1 passage from this document',
        status: 'success',
      }),
    );
  });

  it('previews text in characters, so a preview of emoji is not cut in half', async () => {
    getCollection.mockResolvedValue({ collection });
    addDocument.mockResolvedValue({ documentId: 'document-10', chunkCount: 2 });

    renderWorkspace();

    /** 80 emoji is 80 characters but 160 UTF-16 code units. Slicing at the
     *  code-unit boundary landed inside a character and rendered a replacement
     *  glyph — the preview dropped to half its length and showed a box. The
     *  leading single-unit character puts the boundary mid-pair for certain. */
    await ingest(`x${'👍'.repeat(100)}`);

    await waitFor(() => expect(within(getSessionList()).getAllByRole('listitem')).toHaveLength(1));
    const row = within(getSessionList()).getByRole('listitem');
    /** 80 characters, with the ellipsis that marks a truncated preview. */
    expect(row).toHaveTextContent(`x${'👍'.repeat(79)}…`);
    expect(row.textContent ?? '').not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('blocks a query over the character cap instead of letting the server refuse it', async () => {
    getCollection.mockResolvedValue({ collection });

    renderWorkspace();

    const query = await screen.findByLabelText('Query');
    const run = screen.getByRole('button', { name: 'Run query' });

    fireEvent.change(query, { target: { value: 'a'.repeat(2000) } });
    expect(run).toBeEnabled();
    expect(screen.queryByText(/at most 2000 characters/)).not.toBeInTheDocument();

    fireEvent.change(query, { target: { value: 'a'.repeat(2001) } });
    /** The server counts code points (`characterLength`), so 2001 is refused and
     *  the message is on the field that caused it, not only in a toast. */
    expect(run).toBeDisabled();
    expect(query).toHaveAttribute('aria-invalid', 'true');
    const describedBy = query.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'A query can be at most 2000 characters.',
    );
    expect(retrieveKnowledge).not.toHaveBeenCalled();
  });

  it('accepts a query of emoji at the cap, counting characters rather than code units', async () => {
    getCollection.mockResolvedValue({ collection });
    retrieveKnowledge.mockResolvedValue({ snippets: [] });

    renderWorkspace();

    const query = await screen.findByLabelText('Query');
    fireEvent.change(query, { target: { value: '👍'.repeat(2000) } });

    expect(screen.getByRole('button', { name: 'Run query' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }));

    await waitFor(() => expect(retrieveKnowledge).toHaveBeenCalledTimes(1));
    expect(retrieveKnowledge).toHaveBeenLastCalledWith('collection-1', {
      collectionId: 'collection-1',
      query: '👍'.repeat(2000),
    });
  });

  it('sends one ingest per submit, even while the first is still in flight', async () => {
    getCollection.mockResolvedValue({ collection });
    /** The button is `disabled` on the pending mutation, but a second `submit` —
     *  Enter in the textarea, a double click, a retried request — does not wait for
     *  that attribute to be re-rendered, and `isLoading` is read on a render that
     *  has not happened yet. The document would be indexed twice, and the session
     *  list would show two rows for one paste. */
    let resolveIngest: ((value: { documentId: string; chunkCount: number }) => void) | undefined;
    addDocument.mockImplementation(
      () =>
        new Promise<{ documentId: string; chunkCount: number }>((resolve) => {
          resolveIngest = resolve;
        }),
    );

    renderWorkspace();

    const content = await screen.findByLabelText('Content');
    fireEvent.change(content, { target: { value: 'Expenses are reimbursed monthly.' } });
    const form = content.closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(addDocument).toHaveBeenCalledTimes(1));

    resolveIngest?.({ documentId: 'document-11', chunkCount: 2 });
    await waitFor(() => expect(within(getSessionList()).getAllByRole('listitem')).toHaveLength(1));
  });
});
