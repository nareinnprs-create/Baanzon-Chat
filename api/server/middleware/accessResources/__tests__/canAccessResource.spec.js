jest.mock('~/server/services/PermissionService', () => ({ checkPermission: jest.fn() }));
jest.mock('~/server/middleware/roles/capabilities', () => ({ hasCapability: jest.fn() }));
jest.mock('~/models', () => ({
  getSkillById: jest.fn(),
  getPrompt: jest.fn(),
  getPromptGroup: jest.fn(),
}));
jest.mock('@librechat/api', () => ({ getDeploymentSkillById: jest.fn() }));

const { ResourceType, PermissionBits } = require('librechat-data-provider');
const { checkPermission } = require('~/server/services/PermissionService');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const { getSkillById, getPrompt, getPromptGroup } = require('~/models');
const { getDeploymentSkillById } = require('@librechat/api');

const { canAccessResource } = require('../canAccessResource');
const { canAccessPromptViaGroup } = require('../canAccessPromptViaGroup');
const { canAccessPromptGroupResource } = require('../canAccessPromptGroupResource');
const { canAccessSkillResource } = require('../canAccessSkillResource');

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const makeReq = (params = {}, user = { id: 'user-1', role: 'USER' }) => ({ params, user });

describe('canAccessResource', () => {
  let res;
  let next;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    hasCapability.mockResolvedValue(false);
    checkPermission.mockResolvedValue(false);
  });

  describe('factory validation', () => {
    it('requires a string resourceType', () => {
      expect(() => canAccessResource({ requiredPermission: 1 })).toThrow(
        'resourceType is required and must be a string',
      );
      expect(() => canAccessResource({ resourceType: 5, requiredPermission: 1 })).toThrow(
        'resourceType is required and must be a string',
      );
    });

    it('requires a numeric requiredPermission', () => {
      expect(() => canAccessResource({ resourceType: ResourceType.AGENT })).toThrow(
        'requiredPermission is required and must be a number',
      );
      expect(() =>
        canAccessResource({ resourceType: ResourceType.AGENT, requiredPermission: '1' }),
      ).toThrow('requiredPermission is required and must be a number');
    });

    it('returns an Express middleware function', () => {
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
      });

      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3);
    });
  });

  describe('guards', () => {
    it('returns 400 when the resource id parameter is missing', async () => {
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
      });

      await middleware(makeReq({}, null), res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'resourceId is required',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when the user is not authenticated', async () => {
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
      });

      await middleware(makeReq({ resourceId: 'agent-1' }, null), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('capability bypass', () => {
    it('allows the request when the user holds the resource capability', async () => {
      hasCapability.mockResolvedValue(true);
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
      });

      await middleware(makeReq({ resourceId: 'agent-1' }), res, next);

      expect(hasCapability).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        'manage:agents',
      );
      expect(next).toHaveBeenCalled();
      expect(checkPermission).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('falls through to the ACL check when the capability lookup throws', async () => {
      hasCapability.mockRejectedValue(new Error('capability service down'));
      checkPermission.mockResolvedValue(true);
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
      });

      await middleware(makeReq({ resourceId: 'agent-1' }), res, next);

      expect(checkPermission).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('skips the capability lookup for resource types without a mapped capability', async () => {
      checkPermission.mockResolvedValue(true);
      const middleware = canAccessResource({
        resourceType: 'unmapped-resource',
        requiredPermission: PermissionBits.VIEW,
      });

      await middleware(makeReq({ resourceId: 'thing-1' }), res, next);

      expect(hasCapability).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('id resolution', () => {
    it('returns 404 when the resolver cannot find the resource', async () => {
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
        idResolver: async () => null,
      });

      await middleware(makeReq({ resourceId: 'missing' }), res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'agent not found',
      });
      expect(checkPermission).not.toHaveBeenCalled();
    });

    it('accepts a plain string from the resolver', async () => {
      checkPermission.mockResolvedValue(true);
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
        idResolver: async () => 'resolved-object-id',
      });

      await middleware(makeReq({ resourceId: 'agent-1' }), res, next);

      expect(checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'resolved-object-id' }),
      );
      expect(next).toHaveBeenCalled();
    });

    it('uses the _id and captures the document when the resolver returns an object', async () => {
      checkPermission.mockResolvedValue(true);
      const document = { _id: 'resolved-object-id', id: 'agent-1', name: 'Agent' };
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
        idResolver: async () => document,
      });

      const req = makeReq({ resourceId: 'agent-1' });
      await middleware(req, res, next);

      expect(req.resourceAccess.resourceId).toBe('resolved-object-id');
      expect(req.resourceAccess.resourceInfo).toBe(document);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('permission outcomes', () => {
    it('grants access and records the resolved resource on the request', async () => {
      checkPermission.mockResolvedValue(true);
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.EDIT,
      });

      const req = makeReq({ resourceId: 'agent-1' });
      await middleware(req, res, next);

      expect(checkPermission).toHaveBeenCalledWith({
        userId: 'user-1',
        role: 'USER',
        resourceType: ResourceType.AGENT,
        resourceId: 'agent-1',
        requiredPermission: PermissionBits.EDIT,
      });
      expect(req.resourceAccess).toEqual({
        resourceType: ResourceType.AGENT,
        resourceId: 'agent-1',
        customResourceId: 'agent-1',
        permission: PermissionBits.EDIT,
        userId: 'user-1',
      });
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when the user lacks the required permission', async () => {
      checkPermission.mockResolvedValue(false);
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
      });

      await middleware(makeReq({ resourceId: 'agent-1' }), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Insufficient permissions to access this agent',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 500 when the permission check throws', async () => {
      checkPermission.mockRejectedValue(new Error('db exploded'));
      const middleware = canAccessResource({
        resourceType: ResourceType.AGENT,
        requiredPermission: PermissionBits.VIEW,
      });

      await middleware(makeReq({ resourceId: 'agent-1' }), res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to check resource access permissions',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('canAccessPromptViaGroup', () => {
  let res;
  let next;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    hasCapability.mockResolvedValue(false);
    checkPermission.mockResolvedValue(false);
  });

  it('requires a numeric requiredPermission', () => {
    expect(() => canAccessPromptViaGroup({ requiredPermission: '1' })).toThrow(
      'canAccessPromptViaGroup: requiredPermission is required and must be a number',
    );
  });

  it('checks permissions against the prompt group resolved from the prompt', async () => {
    getPrompt.mockResolvedValue({ _id: 'prompt-1', groupId: 'group-1' });
    checkPermission.mockResolvedValue(true);
    const middleware = canAccessPromptViaGroup({ requiredPermission: PermissionBits.VIEW });

    await middleware(makeReq({ promptId: 'prompt-1' }), res, next);

    expect(getPrompt).toHaveBeenCalledWith({ _id: 'prompt-1' });
    expect(checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: ResourceType.PROMPTGROUP,
        resourceId: 'group-1',
        requiredPermission: PermissionBits.VIEW,
      }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('returns 404 when the prompt has no group', async () => {
    getPrompt.mockResolvedValue({ _id: 'prompt-1' });
    const middleware = canAccessPromptViaGroup({ requiredPermission: PermissionBits.VIEW });

    await middleware(makeReq({ promptId: 'prompt-1' }), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Not Found',
      message: 'promptGroup not found',
    });
  });
});

describe('canAccessPromptGroupResource', () => {
  let res;
  let next;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    hasCapability.mockResolvedValue(false);
    checkPermission.mockResolvedValue(false);
  });

  it('requires a numeric requiredPermission', () => {
    expect(() => canAccessPromptGroupResource({})).toThrow(
      'canAccessPromptGroupResource: requiredPermission is required and must be a number',
    );
  });

  it('resolves the group document and checks permissions against its _id', async () => {
    getPromptGroup.mockResolvedValue({ _id: 'group-1' });
    checkPermission.mockResolvedValue(true);
    const middleware = canAccessPromptGroupResource({ requiredPermission: PermissionBits.VIEW });

    await middleware(makeReq({ groupId: 'group-1' }), res, next);

    expect(getPromptGroup).toHaveBeenCalledWith({ _id: 'group-1' });
    expect(checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: ResourceType.PROMPTGROUP,
        resourceId: 'group-1',
      }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('returns 404 when the group does not exist', async () => {
    getPromptGroup.mockResolvedValue(null);
    const middleware = canAccessPromptGroupResource({ requiredPermission: PermissionBits.VIEW });

    await middleware(makeReq({ groupId: 'group-1' }), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Not Found',
      message: 'promptGroup not found',
    });
  });
});

describe('canAccessSkillResource', () => {
  let res;
  let next;

  beforeEach(() => {
    res = makeRes();
    next = jest.fn();
    hasCapability.mockResolvedValue(false);
    checkPermission.mockResolvedValue(false);
    getDeploymentSkillById.mockReturnValue(null);
  });

  it('requires a numeric requiredPermission', () => {
    expect(() => canAccessSkillResource({})).toThrow(
      'canAccessSkillResource: requiredPermission is required and must be a number',
    );
  });

  it('grants view access to deployment skills without an ACL check', async () => {
    const deploymentSkill = { _id: 'dep-1', name: 'Deployment Skill' };
    getDeploymentSkillById.mockReturnValue(deploymentSkill);
    const middleware = canAccessSkillResource({ requiredPermission: PermissionBits.VIEW });

    const req = makeReq({ id: 'dep-1' });
    await middleware(req, res, next);

    expect(getDeploymentSkillById).toHaveBeenCalledWith('dep-1');
    expect(req.resourceAccess).toEqual({
      resourceType: ResourceType.SKILL,
      resourceId: 'dep-1',
      customResourceId: 'dep-1',
      permission: PermissionBits.VIEW,
      userId: 'user-1',
      resourceInfo: deploymentSkill,
    });
    expect(checkPermission).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('rejects non-view access to deployment skills as read-only', async () => {
    getDeploymentSkillById.mockReturnValue({ _id: 'dep-1' });
    const middleware = canAccessSkillResource({ requiredPermission: PermissionBits.EDIT });

    await middleware(makeReq({ id: 'dep-1' }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      message: 'Deployment skills are read-only',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('delegates user skills to the ACL check via getSkillById', async () => {
    getSkillById.mockResolvedValue({ _id: 'skill-1' });
    checkPermission.mockResolvedValue(true);
    const middleware = canAccessSkillResource({ requiredPermission: PermissionBits.VIEW });

    await middleware(makeReq({ id: 'skill-1' }), res, next);

    expect(getSkillById).toHaveBeenCalledWith('skill-1');
    expect(checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: ResourceType.SKILL, resourceId: 'skill-1' }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('returns 404 when neither a deployment nor a user skill matches', async () => {
    getSkillById.mockResolvedValue(null);
    const middleware = canAccessSkillResource({ requiredPermission: PermissionBits.VIEW });

    await middleware(makeReq({ id: 'skill-1' }), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Not Found',
      message: 'skill not found',
    });
  });
});
