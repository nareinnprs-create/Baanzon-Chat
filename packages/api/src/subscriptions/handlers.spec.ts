import type { Response } from 'express';
import type { SubscriptionDataSource, SubscriptionRecord } from './types';
import type { ServerRequest } from '~/types';
import { createSubscriptionsHandlers } from './handlers';

interface MockResponse {
  res: Response;
  statusCode: number;
  body?: Record<string, unknown>;
}

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
    user: { id: 'user-1', _id: 'user-1', tenantId: 'tenant-a' },
    query: {},
    params: {},
    body: {},
    ...overrides,
  } as unknown as ServerRequest;
}

function dataSource(): jest.Mocked<SubscriptionDataSource> {
  return {
    createSubscription: jest.fn(),
    getSubscription: jest.fn(),
    listSubscriptions: jest.fn(),
    updateSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
  } as unknown as jest.Mocked<SubscriptionDataSource>;
}

const SUBSCRIPTION_ID = '507f1f77bcf86cd799439011';

function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return { _id: SUBSCRIPTION_ID, userId: 'user-1', plan: 'pro', status: 'active', ...overrides };
}

describe('createSubscriptionsHandlers', () => {
  it('returns 401 for every route without an authenticated user', async () => {
    const local = createSubscriptionsHandlers(dataSource());
    const unauthenticated = request({ user: undefined });

    const list = mockResponse();
    await local.list(unauthenticated, list.res);
    expect(list.statusCode).toBe(401);

    const get = mockResponse();
    await local.get(unauthenticated, get.res);
    expect(get.statusCode).toBe(401);

    const create = mockResponse();
    await local.create(unauthenticated, create.res);
    expect(create.statusCode).toBe(401);

    const update = mockResponse();
    await local.update(unauthenticated, update.res);
    expect(update.statusCode).toBe(401);

    const remove = mockResponse();
    await local.delete(unauthenticated, remove.res);
    expect(remove.statusCode).toBe(401);
  });

  it('lists only the authenticated user subscriptions with filters applied', async () => {
    const listSubscriptions = jest.fn().mockResolvedValue([record()]);
    const local = createSubscriptionsHandlers({ ...dataSource(), listSubscriptions });
    const response = mockResponse();

    await local.list(request({ query: { plan: 'pro', status: 'active' } }), response.res);

    expect(listSubscriptions).toHaveBeenCalledWith({
      userId: 'user-1',
      plan: 'pro',
      status: 'active',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      subscriptions: [{ id: SUBSCRIPTION_ID, userId: 'user-1', plan: 'pro', status: 'active' }],
    });
  });

  it('rejects an invalid plan filter', async () => {
    const listSubscriptions = jest.fn();
    const local = createSubscriptionsHandlers({ ...dataSource(), listSubscriptions });
    const response = mockResponse();

    await local.list(request({ query: { plan: 'platinum' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(listSubscriptions).not.toHaveBeenCalled();
  });

  it('hides a subscription owned by another user', async () => {
    const getSubscription = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const local = createSubscriptionsHandlers({ ...dataSource(), getSubscription });
    const response = mockResponse();

    await local.get(request({ params: { id: SUBSCRIPTION_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('hides a subscription belonging to another tenant', async () => {
    const getSubscription = jest.fn().mockResolvedValue(record({ tenantId: 'tenant-b' }));
    const local = createSubscriptionsHandlers({ ...dataSource(), getSubscription });
    const response = mockResponse();

    await local.get(request({ params: { id: SUBSCRIPTION_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('always attributes a new subscription to the authenticated user', async () => {
    const createSubscription = jest.fn().mockResolvedValue(record());
    const local = createSubscriptionsHandlers({ ...dataSource(), createSubscription });
    const response = mockResponse();

    await local.create(request({ body: { plan: 'pro', userId: 'attacker' } }), response.res);

    expect(createSubscription).toHaveBeenCalledWith({ userId: 'user-1', plan: 'pro' });
    expect(response.statusCode).toBe(201);
  });

  it('rejects a subscription without a plan', async () => {
    const createSubscription = jest.fn();
    const local = createSubscriptionsHandlers({ ...dataSource(), createSubscription });
    const response = mockResponse();

    await local.create(request({ body: { status: 'active' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('updates an owned subscription with the validated patch only', async () => {
    const getSubscription = jest.fn().mockResolvedValue(record());
    const updateSubscription = jest.fn().mockResolvedValue(record({ status: 'canceled' }));
    const local = createSubscriptionsHandlers({
      ...dataSource(),
      getSubscription,
      updateSubscription,
    });
    const response = mockResponse();

    await local.update(
      request({
        params: { id: SUBSCRIPTION_ID },
        body: { status: 'canceled', userId: 'attacker' },
      }),
      response.res,
    );

    expect(updateSubscription).toHaveBeenCalledWith(SUBSCRIPTION_ID, { status: 'canceled' });
    expect(response.statusCode).toBe(200);
  });

  it('does not let a client rewrite provider linkage through update', async () => {
    const getSubscription = jest.fn().mockResolvedValue(record());
    const updateSubscription = jest.fn();
    const local = createSubscriptionsHandlers({
      ...dataSource(),
      getSubscription,
      updateSubscription,
    });
    const response = mockResponse();

    await local.update(
      request({ params: { id: SUBSCRIPTION_ID }, body: { stripeCustomerId: 'cus_new' } }),
      response.res,
    );

    expect(response.statusCode).toBe(400);
    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it('refuses to update a subscription owned by another user', async () => {
    const getSubscription = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const updateSubscription = jest.fn();
    const local = createSubscriptionsHandlers({
      ...dataSource(),
      getSubscription,
      updateSubscription,
    });
    const response = mockResponse();

    await local.update(
      request({ params: { id: SUBSCRIPTION_ID }, body: { status: 'canceled' } }),
      response.res,
    );

    expect(response.statusCode).toBe(404);
    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it('deletes an owned subscription', async () => {
    const getSubscription = jest.fn().mockResolvedValue(record());
    const deleteSubscription = jest.fn().mockResolvedValue(true);
    const local = createSubscriptionsHandlers({
      ...dataSource(),
      getSubscription,
      deleteSubscription,
    });
    const response = mockResponse();

    await local.delete(request({ params: { id: SUBSCRIPTION_ID } }), response.res);

    expect(deleteSubscription).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('surfaces a storage failure as a 500', async () => {
    const listSubscriptions = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createSubscriptionsHandlers({ ...dataSource(), listSubscriptions });
    const response = mockResponse();

    await local.list(request(), response.res);

    expect(response.statusCode).toBe(500);
  });
});
