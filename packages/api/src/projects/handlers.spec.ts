import type { Response } from 'express';
import type {
  ChatProjectListResult,
  ChatProjectRecord,
  ProjectDataSource,
  ProjectRequest,
} from './types';
import { createProjectHandlers } from './handlers';

interface MockResponse {
  res: Response;
  statusCode: number;
  body?: Record<string, unknown>;
}

const USER_ID = '507f1f77bcf86cd7994390aa';
const PROJECT_ID = '507f1f77bcf86cd799439011';
const OTHER_PROJECT_ID = '507f1f77bcf86cd799439012';
const WORKSPACE_ID = 'workspace-1';
const OTHER_WORKSPACE_ID = 'workspace-2';

function mockResponse(): MockResponse {
  let statusCode = 200;
  let body: Record<string, unknown> | undefined;
  const response: MockResponse = {
    statusCode,
    body,
    res: undefined as unknown as Response,
  };
  const res = {
    status(code: number) {
      statusCode = code;
      response.statusCode = code;
      return res;
    },
    json(value: Record<string, unknown>) {
      body = value;
      response.body = value;
      return res;
    },
  };
  response.res = res as unknown as Response;
  return response;
}

function projectRequest(overrides: Record<string, unknown> = {}): ProjectRequest {
  return {
    user: { id: USER_ID },
    query: {},
    params: {},
    body: {},
    ...overrides,
  } as unknown as ProjectRequest;
}

function dataSource(): jest.Mocked<ProjectDataSource> {
  /** The default mount wires an access gate; absent means deny. */
  return {
    listChatProjects: jest.fn(),
    createChatProject: jest.fn(),
    getChatProject: jest.fn(),
    updateChatProject: jest.fn(),
    deleteChatProject: jest.fn(),
    assignConversationToProject: jest.fn(),
    assertWorkspaceAccess: jest.fn(),
  } as unknown as jest.Mocked<ProjectDataSource>;
}

function project(overrides: Partial<ChatProjectRecord> = {}): ChatProjectRecord {
  return {
    _id: PROJECT_ID,
    name: 'Roadmap',
    description: '',
    user: USER_ID,
    conversationCount: 0,
    lastConversationAt: null,
    lastConversationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A resolved page for the caller's own rows. */
function listResult(projects: ChatProjectRecord[]): ChatProjectListResult {
  return { projects, nextCursor: null };
}

describe('createProjectHandlers', () => {
  describe('workspace-scoped reads', () => {
    it('excludes projects belonging to another workspace from a scoped list', async () => {
      const listChatProjects = jest.fn().mockResolvedValue(
        listResult([
          project({ workspaceId: WORKSPACE_ID }),
          project({ _id: OTHER_PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID }),
        ]),
      );
      const handlers = createProjectHandlers({ ...dataSource(), listChatProjects });
      const response = mockResponse();

      await handlers.listProjects(
        projectRequest({ query: { workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(200);
      expect(listChatProjects).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      );
      expect(projectsOf(response.body)).toEqual([
        expect.objectContaining({ _id: PROJECT_ID, workspaceId: WORKSPACE_ID }),
      ]);
    });

    it('keeps projects that predate scoping visible inside a workspace', async () => {
      const listChatProjects = jest
        .fn()
        .mockResolvedValue(listResult([project(), project({ workspaceId: OTHER_WORKSPACE_ID })]));
      const handlers = createProjectHandlers({ ...dataSource(), listChatProjects });
      const response = mockResponse();

      await handlers.listProjects(
        projectRequest({ query: { workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(200);
      expect(projectsOf(response.body)).toHaveLength(1);
      expect(projectsOf(response.body)[0]).not.toHaveProperty('workspaceId');
    });

    it('preserves the cursor and any other storage fields on a scoped list', async () => {
      const listChatProjects = jest.fn().mockResolvedValue({
        ...listResult([project({ workspaceId: WORKSPACE_ID })]),
        nextCursor: 'next-page',
      });
      const handlers = createProjectHandlers({ ...dataSource(), listChatProjects });
      const response = mockResponse();

      await handlers.listProjects(
        projectRequest({ query: { workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.body).toMatchObject({ nextCursor: 'next-page' });
    });

    it('returns every project of the caller when no workspace is supplied', async () => {
      const listChatProjects = jest.fn().mockResolvedValue(
        listResult([
          project({ workspaceId: WORKSPACE_ID }),
          project({ _id: OTHER_PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID }),
          project({ _id: '507f1f77bcf86cd799439013' }),
        ]),
      );
      const handlers = createProjectHandlers({ ...dataSource(), listChatProjects });
      const response = mockResponse();

      await handlers.listProjects(projectRequest(), response.res);

      expect(response.statusCode).toBe(200);
      expect(projectsOf(response.body)).toHaveLength(3);
      expect(listChatProjects).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ workspaceId: undefined }),
      );
    });

    it('rejects a non-string workspaceId on a list before querying storage', async () => {
      const listChatProjects = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), listChatProjects });
      const response = mockResponse();

      await handlers.listProjects(
        projectRequest({ query: { workspaceId: [WORKSPACE_ID] } }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'workspaceId must be a string' });
      expect(listChatProjects).not.toHaveBeenCalled();
    });

    it('reads a project in the requested workspace', async () => {
      const getChatProject = jest.fn().mockResolvedValue(project({ workspaceId: WORKSPACE_ID }));
      const handlers = createProjectHandlers({ ...dataSource(), getChatProject });
      const response = mockResponse();

      await handlers.getProject(
        projectRequest({ params: { projectId: PROJECT_ID }, query: { workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(getChatProject).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({ name: 'Roadmap', workspaceId: WORKSPACE_ID });
    });

    it('answers 404 for a project that belongs to another workspace', async () => {
      const getChatProject = jest.fn().mockResolvedValue(project({ workspaceId: OTHER_WORKSPACE_ID }));
      const handlers = createProjectHandlers({ ...dataSource(), getChatProject });
      const response = mockResponse();

      await handlers.getProject(
        projectRequest({ params: { projectId: PROJECT_ID }, query: { workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
    });

    it('rejects a non-string workspaceId on a read before querying storage', async () => {
      const getChatProject = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), getChatProject });
      const response = mockResponse();

      await handlers.getProject(
        projectRequest({
          params: { projectId: PROJECT_ID },
          query: { workspaceId: { id: WORKSPACE_ID } },
        }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'workspaceId must be a string' });
      expect(getChatProject).not.toHaveBeenCalled();
    });

    it('still answers 404 for an invalid project id before reading the scope', async () => {
      const getChatProject = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), getChatProject });
      const response = mockResponse();

      await handlers.getProject(
        projectRequest({
          params: { projectId: 'not-an-id' },
          query: { workspaceId: 42 },
        }),
        response.res,
      );

      expect(response.statusCode).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
      expect(getChatProject).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('stores the workspace the body names', async () => {
      const createChatProject = jest
        .fn()
        .mockResolvedValue(project({ workspaceId: WORKSPACE_ID }));
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject });
      const response = mockResponse();

      await handlers.createProject(
        projectRequest({
          body: { name: '  Roadmap  ', description: 'Q3', workspaceId: ` ${WORKSPACE_ID} ` },
        }),
        response.res,
      );

      expect(createChatProject).toHaveBeenCalledWith(USER_ID, {
        name: 'Roadmap',
        description: 'Q3',
        workspaceId: WORKSPACE_ID,
      });
      expect(response.statusCode).toBe(201);
      expect(response.body).toMatchObject({ name: 'Roadmap', workspaceId: WORKSPACE_ID });
    });

    it('creates an unscoped project when no workspace is named', async () => {
      const createChatProject = jest.fn().mockResolvedValue(project());
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject });
      const response = mockResponse();

      await handlers.createProject(projectRequest({ body: { name: 'Roadmap' } }), response.res);

      expect(createChatProject).toHaveBeenCalledWith(USER_ID, {
        name: 'Roadmap',
        description: '',
        workspaceId: undefined,
      });
      expect(response.statusCode).toBe(201);
      expect(response.body).not.toHaveProperty('workspaceId');
    });

    it('refuses a non-string workspaceId without writing', async () => {
      const createChatProject = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject });
      const response = mockResponse();

      await handlers.createProject(
        projectRequest({ body: { name: 'Roadmap', workspaceId: 7 } }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'workspaceId must be a string' });
      expect(createChatProject).not.toHaveBeenCalled();
    });

    it('keeps the existing name validation ahead of the workspace check', async () => {
      const createChatProject = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject });
      const response = mockResponse();

      await handlers.createProject(
        projectRequest({ body: { name: '   ', workspaceId: 7 } }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'name is required' });
      expect(createChatProject).not.toHaveBeenCalled();
    });

    it('surfaces a storage failure as a 500', async () => {
      const createChatProject = jest.fn().mockRejectedValue(new Error('boom'));
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject });
      const response = mockResponse();

      await handlers.createProject(
        projectRequest({ body: { name: 'Roadmap', workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({ error: 'Error creating project' });
    });
  });

  describe('workspace access', () => {
    it('consults the access guard with the caller and the named workspace before creating', async () => {
      const createChatProject = jest.fn().mockResolvedValue(project({ workspaceId: WORKSPACE_ID }));
      const assertWorkspaceAccess = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject, assertWorkspaceAccess });
      const response = mockResponse();

      await handlers.createProject(
        projectRequest({ body: { name: 'Roadmap', workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(assertWorkspaceAccess).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID);
      expect(response.statusCode).toBe(201);
    });

    it('refuses a create into a workspace the guard denies, writing nothing', async () => {
      const createChatProject = jest.fn();
      const assertWorkspaceAccess = jest.fn().mockRejectedValue(new Error('denied'));
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject, assertWorkspaceAccess });
      const response = mockResponse();

      await handlers.createProject(
        projectRequest({ body: { name: 'Roadmap', workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(403);
      expect(response.body).toEqual({ error: 'Insufficient workspace permissions' });
      expect(createChatProject).not.toHaveBeenCalled();
    });

    it('creates an unscoped project without consulting the guard', async () => {
      const createChatProject = jest.fn().mockResolvedValue(project());
      const assertWorkspaceAccess = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), createChatProject, assertWorkspaceAccess });

      const response = mockResponse();
      await handlers.createProject(projectRequest({ body: { name: 'Roadmap' } }), response.res);

      expect(assertWorkspaceAccess).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(201);
    });

    it('refuses a create when no access check is wired', async () => {
      const createChatProject = jest.fn().mockResolvedValue(project({ workspaceId: WORKSPACE_ID }));
      const deps = dataSource();
      delete (deps as Partial<ProjectDataSource>).assertWorkspaceAccess;
      const handlers = createProjectHandlers({ ...deps, createChatProject });
      const response = mockResponse();

      await handlers.createProject(
        projectRequest({ body: { name: 'Roadmap', workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(403);
      expect(createChatProject).not.toHaveBeenCalled();
    });

    it('refuses an update into a workspace the guard denies, writing nothing', async () => {
      const updateChatProject = jest.fn();
      const assertWorkspaceAccess = jest.fn().mockRejectedValue(new Error('denied'));
      const handlers = createProjectHandlers({ ...dataSource(), updateChatProject, assertWorkspaceAccess });
      const response = mockResponse();

      await handlers.updateProject(
        projectRequest({
          params: { projectId: PROJECT_ID },
          body: { workspaceId: WORKSPACE_ID },
        }),
        response.res,
      );

      expect(response.statusCode).toBe(403);
      expect(response.body).toEqual({ error: 'Insufficient workspace permissions' });
      expect(updateChatProject).not.toHaveBeenCalled();
    });

    it('detaches the workspace when an update sends null', async () => {
      const updateChatProject = jest.fn().mockResolvedValue(project());
      const handlers = createProjectHandlers({ ...dataSource(), updateChatProject });
      const response = mockResponse();

      await handlers.updateProject(
        projectRequest({
          params: { projectId: PROJECT_ID },
          body: { workspaceId: null },
        }),
        response.res,
      );

      expect(updateChatProject).toHaveBeenCalledWith(USER_ID, PROJECT_ID, { workspaceId: null });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('update', () => {
    it('moves a project to the workspace the body names', async () => {
      const updateChatProject = jest
        .fn()
        .mockResolvedValue(project({ workspaceId: OTHER_WORKSPACE_ID }));
      const handlers = createProjectHandlers({ ...dataSource(), updateChatProject });
      const response = mockResponse();

      await handlers.updateProject(
        projectRequest({
          params: { projectId: PROJECT_ID },
          body: { workspaceId: OTHER_WORKSPACE_ID },
        }),
        response.res,
      );

      expect(updateChatProject).toHaveBeenCalledWith(USER_ID, PROJECT_ID, {
        workspaceId: OTHER_WORKSPACE_ID,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({ workspaceId: OTHER_WORKSPACE_ID });
    });

    it('forwards a workspace move alongside the other fields of the patch', async () => {
      const updateChatProject = jest
        .fn()
        .mockResolvedValue(project({ name: 'Renamed', workspaceId: WORKSPACE_ID }));
      const handlers = createProjectHandlers({ ...dataSource(), updateChatProject });
      const response = mockResponse();

      await handlers.updateProject(
        projectRequest({
          params: { projectId: PROJECT_ID },
          body: { name: 'Renamed', description: 'Q3', workspaceId: WORKSPACE_ID },
        }),
        response.res,
      );

      expect(updateChatProject).toHaveBeenCalledWith(USER_ID, PROJECT_ID, {
        name: 'Renamed',
        description: 'Q3',
        workspaceId: WORKSPACE_ID,
      });
      expect(response.statusCode).toBe(200);
    });

    it('refuses a non-string workspaceId without writing', async () => {
      const updateChatProject = jest.fn();
      const handlers = createProjectHandlers({ ...dataSource(), updateChatProject });
      const response = mockResponse();

      await handlers.updateProject(
        projectRequest({ params: { projectId: PROJECT_ID }, body: { workspaceId: false } }),
        response.res,
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'workspaceId must be a string' });
      expect(updateChatProject).not.toHaveBeenCalled();
    });

    it('leaves the project where it is when the workspace is blank', async () => {
      const updateChatProject = jest.fn().mockResolvedValue(project());
      const handlers = createProjectHandlers({ ...dataSource(), updateChatProject });
      const response = mockResponse();

      await handlers.updateProject(
        projectRequest({ params: { projectId: PROJECT_ID }, body: { workspaceId: '  ' } }),
        response.res,
      );

      expect(updateChatProject).toHaveBeenCalledWith(USER_ID, PROJECT_ID, {});
      expect(response.statusCode).toBe(200);
    });

    it('answers 404 when the project is gone', async () => {
      const updateChatProject = jest.fn().mockResolvedValue(null);
      const handlers = createProjectHandlers({ ...dataSource(), updateChatProject });
      const response = mockResponse();

      await handlers.updateProject(
        projectRequest({ params: { projectId: PROJECT_ID }, body: { workspaceId: WORKSPACE_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(404);
      expect(response.body).toEqual({ error: 'Project not found' });
    });
  });

  describe('unscoped behavior that must not change', () => {
    it('keeps the pre-existing sort, search and pagination options', async () => {
      const listChatProjects = jest.fn().mockResolvedValue(listResult([]));
      const handlers = createProjectHandlers({ ...dataSource(), listChatProjects });
      const response = mockResponse();

      await handlers.listProjects(
        projectRequest({
          query: { sortBy: 'name', sortDirection: 'asc', search: 'road', limit: '5' },
        }),
        response.res,
      );

      expect(listChatProjects).toHaveBeenCalledWith(USER_ID, {
        cursor: undefined,
        limit: 5,
        sortBy: 'name',
        sortDirection: 'asc',
        search: 'road',
        workspaceId: undefined,
      });
    });

    it('keeps a foreign-workspace project readable when no workspace is requested', async () => {
      const getChatProject = jest.fn().mockResolvedValue(project({ workspaceId: OTHER_WORKSPACE_ID }));
      const handlers = createProjectHandlers({ ...dataSource(), getChatProject });
      const response = mockResponse();

      await handlers.getProject(
        projectRequest({ params: { projectId: PROJECT_ID } }),
        response.res,
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({ workspaceId: OTHER_WORKSPACE_ID });
    });

    it('still deletes by id without a workspace scope', async () => {
      const deleteChatProject = jest.fn().mockResolvedValue({ deletedCount: 1, modifiedCount: 2 });
      const handlers = createProjectHandlers({ ...dataSource(), deleteChatProject });
      const response = mockResponse();

      await handlers.deleteProject(
        projectRequest({ params: { projectId: PROJECT_ID } }),
        response.res,
      );

      expect(deleteChatProject).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ deletedCount: 1, modifiedCount: 2 });
    });

    it('still assigns a conversation to a project', async () => {
      const assignConversationToProject = jest
        .fn()
        .mockResolvedValue({ conversationId: 'convo-1', projectId: PROJECT_ID });
      const handlers = createProjectHandlers({ ...dataSource(), assignConversationToProject });
      const response = mockResponse();

      await handlers.assignConversationToProject(
        projectRequest({ params: { conversationId: 'convo-1' }, body: { projectId: PROJECT_ID } }),
        response.res,
      );

      expect(assignConversationToProject).toHaveBeenCalledWith(USER_ID, 'convo-1', PROJECT_ID);
      expect(response.statusCode).toBe(200);
    });
  });
});

function projectsOf(body: Record<string, unknown> | undefined): ChatProjectRecord[] {
  return (body?.projects as ChatProjectRecord[] | undefined) ?? [];
}