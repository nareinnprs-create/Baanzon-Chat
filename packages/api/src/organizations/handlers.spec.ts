import type { Response } from 'express';
import type { MembershipRecord, OrganizationDataSource, OrganizationRecord } from './types';
import type { ServerRequest } from '~/types';
import { createOrganizationHandlers } from './handlers';

interface MockResponse {
  res: Response;
  statusCode: number;
  body?: Record<string, unknown>;
}

const USER_ID = '507f1f77bcf86cd7994390aa';
const OTHER_USER_ID = '507f1f77bcf86cd7994390bb';
const THIRD_USER_ID = '507f1f77bcf86cd7994390cc';
const ORG_ID = '507f1f77bcf86cd799439011';
const MEMBERSHIP_ID = '507f1f77bcf86cd7994390dd';
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

function dataSource(): jest.Mocked<OrganizationDataSource> {
  return {
    createOrganization: jest.fn(),
    getOrganization: jest.fn(),
    listOrganizationsForUser: jest.fn(),
    updateOrganization: jest.fn(),
    deleteOrganization: jest.fn(),
    getMembership: jest.fn(),
    listOrganizationMemberships: jest.fn(),
    addMembership: jest.fn(),
    updateMembership: jest.fn(),
    removeMembership: jest.fn(),
  } as unknown as jest.Mocked<OrganizationDataSource>;
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
    _id: MEMBERSHIP_ID,
    organizationId: ORG_ID,
    userId: OTHER_USER_ID,
    role: 'member',
    status: 'active',
    tenantId: TENANT_ID,
    ...overrides,
  };
}

/**
 * An organization owned by someone other than the requester, with the roles
 * named in `roles`. A user absent from `roles` has no membership at all, which
 * is what a 404 is built on.
 */
function depsFor(options: {
  ownerId?: string;
  roles?: Record<string, MembershipRecord['role']>;
  status?: MembershipRecord['status'];
}): jest.Mocked<OrganizationDataSource> {
  const deps = dataSource();
  deps.getOrganization.mockResolvedValue(organization({ owner: options.ownerId ?? OTHER_USER_ID }));
  deps.getMembership.mockImplementation(async (_organizationId: string, userId: string) => {
    const role = options.roles?.[userId];
    if (role == null) {
      return null;
    }
    return membership({ userId, role, status: options.status ?? 'active' });
  });
  return deps;
}

/** The requester IS the document owner, which outranks any membership row. */
function asOwner(
  extraRoles: Record<string, MembershipRecord['role']> = {},
): jest.Mocked<OrganizationDataSource> {
  return depsFor({ ownerId: USER_ID, roles: { [USER_ID]: 'owner', ...extraRoles } });
}

function asRole(
  role: Exclude<MembershipRecord['role'], undefined>,
): jest.Mocked<OrganizationDataSource> {
  return depsFor({ roles: { [USER_ID]: role } });
}

describe('createOrganizationHandlers', () => {
  it('returns 401 for every route without an authenticated user', async () => {
    const local = createOrganizationHandlers(dataSource());
    const unauthenticated = request({ user: undefined });

    const list = mockResponse();
    await local.list(unauthenticated, list.res);
    expect(list.statusCode).toBe(401);

    const create = mockResponse();
    await local.create(unauthenticated, create.res);
    expect(create.statusCode).toBe(401);

    const get = mockResponse();
    await local.get(request({ user: undefined, params: { organizationId: ORG_ID } }), get.res);
    expect(get.statusCode).toBe(401);

    const update = mockResponse();
    await local.update(
      request({ user: undefined, params: { organizationId: ORG_ID } }),
      update.res,
    );
    expect(update.statusCode).toBe(401);

    const remove = mockResponse();
    await local.delete(
      request({ user: undefined, params: { organizationId: ORG_ID } }),
      remove.res,
    );
    expect(remove.statusCode).toBe(401);

    const listMembers = mockResponse();
    await local.listMembers(
      request({ user: undefined, params: { organizationId: ORG_ID } }),
      listMembers.res,
    );
    expect(listMembers.statusCode).toBe(401);

    const addMember = mockResponse();
    await local.addMember(
      request({ user: undefined, params: { organizationId: ORG_ID } }),
      addMember.res,
    );
    expect(addMember.statusCode).toBe(401);

    const updateMember = mockResponse();
    await local.updateMember(
      request({ user: undefined, params: { organizationId: ORG_ID, userId: OTHER_USER_ID } }),
      updateMember.res,
    );
    expect(updateMember.statusCode).toBe(401);

    const removeMember = mockResponse();
    await local.removeMember(
      request({ user: undefined, params: { organizationId: ORG_ID, userId: OTHER_USER_ID } }),
      removeMember.res,
    );
    expect(removeMember.statusCode).toBe(401);
  });

  it('lists only the organizations the authenticated user belongs to', async () => {
    const listOrganizationsForUser = jest.fn().mockResolvedValue([organization()]);
    const local = createOrganizationHandlers({ ...dataSource(), listOrganizationsForUser });
    const response = mockResponse();

    await local.list(request(), response.res);

    expect(listOrganizationsForUser).toHaveBeenCalledWith(USER_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      organizations: [
        {
          id: ORG_ID,
          name: 'Acme',
          slug: 'acme',
          ownerId: OTHER_USER_ID,
          status: 'active',
          isPersonal: false,
          tenantId: TENANT_ID,
        },
      ],
    });
  });

  it('always attributes a new organization to the authenticated user and writes the owner membership', async () => {
    const createOrganization = jest.fn().mockResolvedValue(organization({ owner: USER_ID }));
    const addMembership = jest
      .fn()
      .mockResolvedValue(membership({ role: 'owner', userId: USER_ID }));
    const local = createOrganizationHandlers({
      ...dataSource(),
      createOrganization,
      addMembership,
    });
    const response = mockResponse();

    await local.create(
      request({ body: { name: 'Acme', owner: 'attacker', settings: { locale: 'en' } } }),
      response.res,
    );

    expect(createOrganization).toHaveBeenCalledWith({
      name: 'Acme',
      slug: undefined,
      settings: { locale: 'en' },
      owner: USER_ID,
    });
    expect(addMembership).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'owner',
    });
    expect(response.statusCode).toBe(201);
  });

  it('rejects a blank organization name without writing', async () => {
    const createOrganization = jest.fn();
    const local = createOrganizationHandlers({ ...dataSource(), createOrganization });
    const response = mockResponse();

    await local.create(request({ body: { name: '   ' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('returns 404 for an organization the user is not a member of', async () => {
    const local = createOrganizationHandlers(depsFor({}));
    const response = mockResponse();

    await local.get(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('does not confirm a suspended membership', async () => {
    const local = createOrganizationHandlers(
      depsFor({ roles: { [USER_ID]: 'member' }, status: 'suspended' }),
    );
    const response = mockResponse();

    await local.get(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('hides an organization belonging to another tenant', async () => {
    const deps = asRole('member');
    deps.getOrganization.mockResolvedValue(organization({ tenantId: 'tenant-b' }));
    const local = createOrganizationHandlers(deps);
    const response = mockResponse();

    await local.get(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('returns the organization to a member', async () => {
    const local = createOrganizationHandlers(asRole('member'));
    const response = mockResponse();

    await local.get(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ id: ORG_ID, name: 'Acme' });
  });

  it('rejects a malformed organization id before reading storage', async () => {
    const getOrganization = jest.fn();
    const local = createOrganizationHandlers({ ...dataSource(), getOrganization });
    const response = mockResponse();

    await local.get(request({ params: { organizationId: 'not-an-id' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(getOrganization).not.toHaveBeenCalled();
  });

  it('refuses an update from a member below admin', async () => {
    const updateOrganization = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('member'), updateOrganization });
    const response = mockResponse();

    await local.update(
      request({ params: { organizationId: ORG_ID }, body: { name: 'Renamed' } }),
      response.res,
    );

    expect(response.statusCode).toBe(403);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('updates name and settings as an admin, dropping unknown fields', async () => {
    const updateOrganization = jest
      .fn()
      .mockResolvedValue(organization({ name: 'Renamed', settings: { locale: 'fr' } }));
    const local = createOrganizationHandlers({ ...asRole('admin'), updateOrganization });
    const response = mockResponse();

    await local.update(
      request({
        params: { organizationId: ORG_ID },
        body: { name: 'Renamed', settings: { locale: 'fr' }, owner: 'attacker' },
      }),
      response.res,
    );

    expect(updateOrganization).toHaveBeenCalledWith(ORG_ID, {
      name: 'Renamed',
      settings: { locale: 'fr' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('keeps status changes owner-only', async () => {
    const updateOrganization = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('admin'), updateOrganization });
    const response = mockResponse();

    await local.update(
      request({ params: { organizationId: ORG_ID }, body: { status: 'suspended' } }),
      response.res,
    );

    expect(response.statusCode).toBe(403);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('lets the owner suspend the organization', async () => {
    const updateOrganization = jest.fn().mockResolvedValue(organization({ status: 'suspended' }));
    const local = createOrganizationHandlers({ ...asOwner(), updateOrganization });
    const response = mockResponse();

    await local.update(
      request({ params: { organizationId: ORG_ID }, body: { status: 'suspended' } }),
      response.res,
    );

    expect(updateOrganization).toHaveBeenCalledWith(ORG_ID, { status: 'suspended' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects an empty update patch', async () => {
    const updateOrganization = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('admin'), updateOrganization });
    const response = mockResponse();

    await local.update(request({ params: { organizationId: ORG_ID }, body: {} }), response.res);

    expect(response.statusCode).toBe(400);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('refuses to delete the organization for an admin', async () => {
    const deleteOrganization = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('admin'), deleteOrganization });
    const response = mockResponse();

    await local.delete(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(403);
    expect(deleteOrganization).not.toHaveBeenCalled();
  });

  it('deletes the organization for the owner', async () => {
    const deleteOrganization = jest.fn().mockResolvedValue(true);
    const local = createOrganizationHandlers({ ...asOwner(), deleteOrganization });
    const response = mockResponse();

    await local.delete(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(deleteOrganization).toHaveBeenCalledWith(ORG_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('keeps the member roster to admins', async () => {
    const listOrganizationMemberships = jest.fn().mockResolvedValue([membership()]);

    const denied = createOrganizationHandlers({
      ...asRole('member'),
      listOrganizationMemberships,
    });
    const deniedResponse = mockResponse();
    await denied.listMembers(request({ params: { organizationId: ORG_ID } }), deniedResponse.res);
    expect(deniedResponse.statusCode).toBe(403);
    expect(listOrganizationMemberships).not.toHaveBeenCalled();

    const allowed = createOrganizationHandlers({
      ...asRole('admin'),
      listOrganizationMemberships,
    });
    const response = mockResponse();
    await allowed.listMembers(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      members: [
        {
          id: MEMBERSHIP_ID,
          organizationId: ORG_ID,
          userId: OTHER_USER_ID,
          role: 'member',
          status: 'active',
        },
      ],
    });
  });

  it('never lets a membership grant ownership', async () => {
    const addMembership = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('admin'), addMembership });
    const response = mockResponse();

    await local.addMember(
      request({
        params: { organizationId: ORG_ID },
        body: { userId: THIRD_USER_ID, role: 'owner' },
      }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(addMembership).not.toHaveBeenCalled();
  });

  it('rejects a member userId that is not an object id', async () => {
    const addMembership = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('admin'), addMembership });
    const response = mockResponse();

    await local.addMember(
      request({ params: { organizationId: ORG_ID }, body: { userId: 'not-an-id' } }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(addMembership).not.toHaveBeenCalled();
  });

  it('adds a member as an admin, defaulting the role to member', async () => {
    const addMembership = jest.fn().mockResolvedValue(membership({ userId: THIRD_USER_ID }));
    const local = createOrganizationHandlers({ ...asRole('admin'), addMembership });
    const response = mockResponse();

    await local.addMember(
      request({ params: { organizationId: ORG_ID }, body: { userId: THIRD_USER_ID } }),
      response.res,
    );

    expect(addMembership).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      userId: THIRD_USER_ID,
      role: 'member',
      status: undefined,
      invitedBy: USER_ID,
    });
    expect(response.statusCode).toBe(201);
  });

  it('refuses to let an admin re-grant the owner membership', async () => {
    const deps = asRole('admin');
    deps.getMembership.mockImplementation(async (_organizationId: string, userId: string) => {
      if (userId === USER_ID) {
        return membership({ userId, role: 'admin' });
      }
      return membership({ userId, role: 'owner' });
    });
    const addMembership = jest.fn();
    const local = createOrganizationHandlers({ ...deps, addMembership });
    const response = mockResponse();

    await local.addMember(
      request({ params: { organizationId: ORG_ID }, body: { userId: OTHER_USER_ID } }),
      response.res,
    );

    expect(response.statusCode).toBe(403);
    expect(addMembership).not.toHaveBeenCalled();
  });

  it('returns 404 for a member that does not exist', async () => {
    const updateMembership = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('admin'), updateMembership });
    const response = mockResponse();

    await local.updateMember(
      request({
        params: { organizationId: ORG_ID, userId: THIRD_USER_ID },
        body: { role: 'viewer' },
      }),
      response.res,
    );

    expect(response.statusCode).toBe(404);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it('keeps an admin from demoting a peer admin', async () => {
    const deps = asRole('admin');
    deps.getMembership.mockImplementation(async (_organizationId: string, userId: string) =>
      membership({ userId, role: userId === USER_ID ? 'admin' : 'admin' }),
    );
    const updateMembership = jest.fn();
    const local = createOrganizationHandlers({ ...deps, updateMembership });
    const response = mockResponse();

    await local.updateMember(
      request({
        params: { organizationId: ORG_ID, userId: THIRD_USER_ID },
        body: { role: 'viewer' },
      }),
      response.res,
    );

    expect(response.statusCode).toBe(403);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it('lets the owner demote any non-owner member', async () => {
    const updateMembership = jest.fn().mockResolvedValue(membership({ role: 'viewer' }));
    const local = createOrganizationHandlers({
      ...asOwner({ [THIRD_USER_ID]: 'admin' }),
      updateMembership,
    });
    const response = mockResponse();

    await local.updateMember(
      request({
        params: { organizationId: ORG_ID, userId: THIRD_USER_ID },
        body: { role: 'viewer' },
      }),
      response.res,
    );

    expect(updateMembership).toHaveBeenCalledWith(ORG_ID, THIRD_USER_ID, { role: 'viewer' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects an empty member patch', async () => {
    const updateMembership = jest.fn();
    const local = createOrganizationHandlers({ ...asRole('admin'), updateMembership });
    const response = mockResponse();

    await local.updateMember(
      request({ params: { organizationId: ORG_ID, userId: THIRD_USER_ID }, body: {} }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it('never removes the organization owner, not even by the owner', async () => {
    const removeMembership = jest.fn();
    const local = createOrganizationHandlers({ ...asOwner(), removeMembership });
    const response = mockResponse();

    await local.removeMember(
      request({ params: { organizationId: ORG_ID, userId: USER_ID } }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(removeMembership).not.toHaveBeenCalled();
  });

  it('removes a plain member for an admin', async () => {
    const deps = asRole('admin');
    deps.getMembership.mockImplementation(async (_organizationId: string, userId: string) =>
      membership({ userId, role: userId === USER_ID ? 'admin' : 'member' }),
    );
    const removeMembership = jest.fn().mockResolvedValue(true);
    const local = createOrganizationHandlers({ ...deps, removeMembership });
    const response = mockResponse();

    await local.removeMember(
      request({ params: { organizationId: ORG_ID, userId: THIRD_USER_ID } }),
      response.res,
    );

    expect(removeMembership).toHaveBeenCalledWith(ORG_ID, THIRD_USER_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('surfaces a storage failure as a 500', async () => {
    const listOrganizationsForUser = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createOrganizationHandlers({ ...dataSource(), listOrganizationsForUser });
    const response = mockResponse();

    await local.list(request(), response.res);

    expect(response.statusCode).toBe(500);
  });

  it('surfaces a failed organization read as a 500 instead of a hang', async () => {
    const getOrganization = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createOrganizationHandlers({ ...dataSource(), getOrganization });
    const response = mockResponse();

    await local.get(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'Error loading organization' });
  });

  it('surfaces a failed membership read as a 500', async () => {
    const deps = asRole('member');
    deps.getMembership.mockRejectedValue(new Error('boom'));
    const updateOrganization = jest.fn();
    const local = createOrganizationHandlers({ ...deps, updateOrganization });
    const response = mockResponse();

    await local.update(
      request({ params: { organizationId: ORG_ID }, body: { name: 'Renamed' } }),
      response.res,
    );

    expect(response.statusCode).toBe(500);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('resolves the organization and the membership in one batch', async () => {
    const deps = asRole('member');
    const local = createOrganizationHandlers(deps);
    const response = mockResponse();

    await local.get(request({ params: { organizationId: ORG_ID } }), response.res);

    expect(deps.getOrganization).toHaveBeenCalledWith(ORG_ID);
    expect(deps.getMembership).toHaveBeenCalledWith(ORG_ID, USER_ID);
    expect(response.statusCode).toBe(200);
  });
});
