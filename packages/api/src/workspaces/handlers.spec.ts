import type { Response } from 'express';
import type { MembershipRecord, OrganizationRecord } from '../organizations/types';
import type { WorkspaceDataSource, WorkspaceRecord } from './types';
import type { ServerRequest } from '~/types';
import { createWorkspaceHandlers } from './handlers';

interface MockResponse {
  res: Response;
  statusCode: number;
  body?: Record<string, unknown>;
}

const USER_ID = '507f1f77bcf86cd7994390aa';
const OTHER_USER_ID = '507f1f77bcf86cd7994390bb';
const ORG_ID = '507f1f77bcf86cd799439011';
const WORKSPACE_ID = '507f1f77bcf86cd799439012';
const TENANT_ID = 'tenant-a';

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

function request(overrides: Record<string, unknown> = {}): ServerRequest {
  return {
    user: { id: USER_ID, _id: USER_ID, tenantId: TENANT_ID },
    query: {},
    params: {},
    body: {},
    ...overrides,
  } as unknown as ServerRequest;
}

function dataSource(): jest.Mocked<WorkspaceDataSource> {
  return {
    createWorkspace: jest.fn(),
    getWorkspace: jest.fn(),
    listWorkspaces: jest.fn(),
    updateWorkspace: jest.fn(),
    deleteWorkspace: jest.fn(),
    getOrganization: jest.fn(),
    getMembership: jest.fn(),
  } as unknown as jest.Mocked<WorkspaceDataSource>;
}

function organization(overrides: Partial<OrganizationRecord> = {}): OrganizationRecord {
  return {
    _id: ORG_ID,
    name: 'Acme',
    slug: 'acme',
    owner: OTHER_USER_ID,
    status: 'active',
    isPersonal: false,
    tenantId: TENANT_ID,
    ...overrides,
  };
}

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    _id: '507f1f77bcf86cd7994390dd',
    organizationId: ORG_ID,
    userId: USER_ID,
    role: 'member',
    status: 'active',
    tenantId: TENANT_ID,
    ...overrides,
  };
}

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    _id: WORKSPACE_ID,
    organizationId: ORG_ID,
    name: 'Engineering',
    slug: 'engineering',
    description: '',
    visibility: 'org',
    createdBy: OTHER_USER_ID,
    tenantId: TENANT_ID,
    ...overrides,
  };
}

/** The requester is a plain member of an organization they do not own. */
function asRole(role: MembershipRecord['role']): jest.Mocked<WorkspaceDataSource> {
  const deps = dataSource();
  deps.getOrganization.mockResolvedValue(organization());
  deps.getMembership.mockResolvedValue(membership({ role }));
  return deps;
}

describe('createWorkspaceHandlers', () => {
  it('returns 401 for every route without an authenticated user', async () => {
    const local = createWorkspaceHandlers(dataSource());
    const unauthenticated = request({ user: undefined });

    const list = mockResponse();
    await local.list(unauthenticated, list.res);
    expect(list.statusCode).toBe(401);

    const create = mockResponse();
    await local.create(unauthenticated, create.res);
    expect(create.statusCode).toBe(401);

    const get = mockResponse();
    await local.get(request({ user: undefined, params: { workspaceId: WORKSPACE_ID } }), get.res);
    expect(get.statusCode).toBe(401);

    const update = mockResponse();
    await local.update(
      request({ user: undefined, params: { workspaceId: WORKSPACE_ID } }),
      update.res,
    );
    expect(update.statusCode).toBe(401);

    const remove = mockResponse();
    await local.delete(
      request({ user: undefined, params: { workspaceId: WORKSPACE_ID } }),
      remove.res,
    );
    expect(remove.statusCode).toBe(401);
  });

  it('requires an organizationId query filter', async () => {
    const listWorkspaces = jest.fn();
    const local = createWorkspaceHandlers({ ...dataSource(), listWorkspaces });
    const response = mockResponse();

    await local.list(request(), response.res);

    expect(response.statusCode).toBe(400);
    expect(listWorkspaces).not.toHaveBeenCalled();
  });

  it('lists the workspaces of an organization the caller belongs to', async () => {
    const listWorkspaces = jest.fn().mockResolvedValue([workspace()]);
    const local = createWorkspaceHandlers({ ...asRole('member'), listWorkspaces });
    const response = mockResponse();

    await local.list(request({ query: { organizationId: ORG_ID } }), response.res);

    expect(listWorkspaces).toHaveBeenCalledWith(ORG_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      workspaces: [
        {
          id: WORKSPACE_ID,
          organizationId: ORG_ID,
          name: 'Engineering',
          slug: 'engineering',
          description: '',
          visibility: 'org',
          createdBy: OTHER_USER_ID,
          tenantId: TENANT_ID,
        },
      ],
    });
  });

  it('hides a private workspace from a plain member in the list', async () => {
    const listWorkspaces = jest
      .fn()
      .mockResolvedValue([
        workspace(),
        workspace({ _id: '507f1f77bcf86cd799439013', visibility: 'private' }),
      ]);
    const local = createWorkspaceHandlers({ ...asRole('member'), listWorkspaces });
    const response = mockResponse();

    await local.list(request({ query: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(200);
    expect((response.body as { workspaces: unknown[] }).workspaces).toHaveLength(1);
  });

  it('hides a private workspace from a member on a direct read', async () => {
    const deps = asRole('member');
    deps.getWorkspace.mockResolvedValue(workspace({ visibility: 'private' }));
    const local = createWorkspaceHandlers(deps);
    const response = mockResponse();

    await local.get(request({ params: { workspaceId: WORKSPACE_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('shows a private workspace to its creator', async () => {
    const deps = asRole('member');
    deps.getWorkspace.mockResolvedValue(workspace({ visibility: 'private', createdBy: USER_ID }));
    const local = createWorkspaceHandlers(deps);
    const response = mockResponse();

    await local.get(request({ params: { workspaceId: WORKSPACE_ID } }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ id: WORKSPACE_ID, visibility: 'private' });
  });

  it('shows a private workspace to an admin who did not create it', async () => {
    const deps = asRole('admin');
    deps.getWorkspace.mockResolvedValue(workspace({ visibility: 'private' }));
    const local = createWorkspaceHandlers(deps);
    const response = mockResponse();

    await local.get(request({ params: { workspaceId: WORKSPACE_ID } }), response.res);

    expect(response.statusCode).toBe(200);
  });

  it('returns 404 for an organization the caller is not a member of', async () => {
    const deps = dataSource();
    deps.getOrganization.mockResolvedValue(organization());
    deps.getMembership.mockResolvedValue(null);
    const local = createWorkspaceHandlers(deps);
    const response = mockResponse();

    await local.list(request({ query: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('hides an organization belonging to another tenant', async () => {
    const deps = asRole('member');
    deps.getOrganization.mockResolvedValue(organization({ tenantId: 'tenant-b' }));
    const local = createWorkspaceHandlers(deps);
    const response = mockResponse();

    await local.list(request({ query: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('hides a workspace belonging to another tenant', async () => {
    const deps = asRole('member');
    deps.getWorkspace.mockResolvedValue(workspace({ tenantId: 'tenant-b' }));
    const local = createWorkspaceHandlers(deps);
    const response = mockResponse();

    await local.get(request({ params: { workspaceId: WORKSPACE_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed workspace id before reading storage', async () => {
    const getWorkspace = jest.fn();
    const local = createWorkspaceHandlers({ ...dataSource(), getWorkspace });
    const response = mockResponse();

    await local.get(request({ params: { workspaceId: 'not-an-id' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it('attributes a new workspace to the authenticated user, not the body', async () => {
    const createWorkspace = jest.fn().mockResolvedValue(workspace({ createdBy: USER_ID }));
    const local = createWorkspaceHandlers({ ...asRole('member'), createWorkspace });
    const response = mockResponse();

    await local.create(
      request({
        body: { organizationId: ORG_ID, name: 'Engineering', createdBy: 'attacker' },
      }),
      response.res,
    );

    expect(createWorkspace).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      name: 'Engineering',
      slug: undefined,
      description: undefined,
      visibility: undefined,
      createdBy: USER_ID,
    });
    expect(response.statusCode).toBe(201);
  });

  it('refuses to create a workspace in an organization the caller does not belong to', async () => {
    const deps = dataSource();
    deps.getOrganization.mockResolvedValue(organization());
    deps.getMembership.mockResolvedValue(null);
    const createWorkspace = jest.fn();
    const local = createWorkspaceHandlers({ ...deps, createWorkspace });
    const response = mockResponse();

    await local.create(
      request({ body: { organizationId: ORG_ID, name: 'Engineering' } }),
      response.res,
    );

    expect(response.statusCode).toBe(404);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('refuses to create a workspace for a viewer', async () => {
    const createWorkspace = jest.fn();
    const local = createWorkspaceHandlers({ ...asRole('viewer'), createWorkspace });
    const response = mockResponse();

    await local.create(
      request({ body: { organizationId: ORG_ID, name: 'Engineering' } }),
      response.res,
    );

    expect(response.statusCode).toBe(403);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('rejects a malformed create payload without writing', async () => {
    const createWorkspace = jest.fn();
    const local = createWorkspaceHandlers({ ...asRole('member'), createWorkspace });
    const response = mockResponse();

    await local.create(request({ body: { organizationId: ORG_ID, name: '   ' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('refuses to update a workspace for a plain member', async () => {
    const deps = asRole('member');
    deps.getWorkspace.mockResolvedValue(workspace());
    const updateWorkspace = jest.fn();
    const local = createWorkspaceHandlers({ ...deps, updateWorkspace });
    const response = mockResponse();

    await local.update(
      request({ params: { workspaceId: WORKSPACE_ID }, body: { name: 'Renamed' } }),
      response.res,
    );

    expect(response.statusCode).toBe(403);
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it('updates a workspace for an admin with the validated patch only', async () => {
    const deps = asRole('admin');
    deps.getWorkspace.mockResolvedValue(workspace());
    const updateWorkspace = jest.fn().mockResolvedValue(workspace({ name: 'Renamed' }));
    const local = createWorkspaceHandlers({ ...deps, updateWorkspace });
    const response = mockResponse();

    await local.update(
      request({
        params: { workspaceId: WORKSPACE_ID },
        body: { name: 'Renamed', organizationId: 'attacker' },
      }),
      response.res,
    );

    expect(updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { name: 'Renamed' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects an empty workspace patch', async () => {
    const deps = asRole('admin');
    deps.getWorkspace.mockResolvedValue(workspace());
    const updateWorkspace = jest.fn();
    const local = createWorkspaceHandlers({ ...deps, updateWorkspace });
    const response = mockResponse();

    await local.update(request({ params: { workspaceId: WORKSPACE_ID }, body: {} }), response.res);

    expect(response.statusCode).toBe(400);
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it('refuses to delete a workspace for a plain member', async () => {
    const deps = asRole('member');
    deps.getWorkspace.mockResolvedValue(workspace());
    const deleteWorkspace = jest.fn();
    const local = createWorkspaceHandlers({ ...deps, deleteWorkspace });
    const response = mockResponse();

    await local.delete(request({ params: { workspaceId: WORKSPACE_ID } }), response.res);

    expect(response.statusCode).toBe(403);
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it('deletes a workspace for an admin', async () => {
    const deps = asRole('admin');
    deps.getWorkspace.mockResolvedValue(workspace());
    const deleteWorkspace = jest.fn().mockResolvedValue(true);
    const local = createWorkspaceHandlers({ ...deps, deleteWorkspace });
    const response = mockResponse();

    await local.delete(request({ params: { workspaceId: WORKSPACE_ID } }), response.res);

    expect(deleteWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('surfaces a storage failure as a 500', async () => {
    const listWorkspaces = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createWorkspaceHandlers({ ...asRole('member'), listWorkspaces });
    const response = mockResponse();

    await local.list(request({ query: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(500);
  });

  it('surfaces a failed workspace read as a 500 instead of a hang', async () => {
    const getWorkspace = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createWorkspaceHandlers({ ...asRole('member'), getWorkspace });
    const response = mockResponse();

    await local.get(request({ params: { workspaceId: WORKSPACE_ID } }), response.res);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'Error loading workspace' });
  });

  it('surfaces a failed organization read as a 500', async () => {
    const deps = asRole('member');
    deps.getOrganization.mockRejectedValue(new Error('boom'));
    const listWorkspaces = jest.fn();
    const local = createWorkspaceHandlers({ ...deps, listWorkspaces });
    const response = mockResponse();

    await local.list(request({ query: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(500);
    expect(listWorkspaces).not.toHaveBeenCalled();
  });

  it('resolves the organization and the membership in one batch', async () => {
    const deps = asRole('member');
    const local = createWorkspaceHandlers(deps);
    const response = mockResponse();

    await local.list(request({ query: { organizationId: ORG_ID } }), response.res);

    expect(deps.getOrganization).toHaveBeenCalledWith(ORG_ID);
    expect(deps.getMembership).toHaveBeenCalledWith(ORG_ID, USER_ID);
  });
});
