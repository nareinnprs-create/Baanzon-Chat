import type { Response } from 'express';
import type { DeviceDataSource, DeviceRecord } from './types';
import type { ServerRequest } from '~/types';
import { createDevicesHandlers } from './handlers';

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

function dataSource(): jest.Mocked<DeviceDataSource> {
  return {
    createDevice: jest.fn(),
    getDevice: jest.fn(),
    listDevices: jest.fn(),
    updateDevice: jest.fn(),
    deleteDevice: jest.fn(),
  } as unknown as jest.Mocked<DeviceDataSource>;
}

const DEVICE_ID = '507f1f77bcf86cd799439011';

function record(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return { _id: DEVICE_ID, userId: 'user-1', deviceName: 'Laptop', isActive: true, ...overrides };
}

describe('createDevicesHandlers', () => {
  it('returns 401 for every route without an authenticated user', async () => {
    const local = createDevicesHandlers(dataSource());
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

  it('lists only the authenticated user devices with filters applied', async () => {
    const listDevices = jest.fn().mockResolvedValue([record()]);
    const local = createDevicesHandlers({ ...dataSource(), listDevices });
    const response = mockResponse();

    await local.list(request({ query: { active: 'true' } }), response.res);

    expect(listDevices).toHaveBeenCalledWith({ userId: 'user-1', isActive: true });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      devices: [{ id: DEVICE_ID, userId: 'user-1', deviceName: 'Laptop', isActive: true }],
    });
  });

  it('rejects an invalid active filter', async () => {
    const listDevices = jest.fn();
    const local = createDevicesHandlers({ ...dataSource(), listDevices });
    const response = mockResponse();

    await local.list(request({ query: { active: 'yes' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(listDevices).not.toHaveBeenCalled();
  });

  it('returns 404 for a device owned by another user', async () => {
    const getDevice = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const local = createDevicesHandlers({ ...dataSource(), getDevice });
    const response = mockResponse();

    await local.get(request({ params: { id: DEVICE_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('hides a device belonging to another tenant', async () => {
    const getDevice = jest.fn().mockResolvedValue(record({ tenantId: 'tenant-b' }));
    const local = createDevicesHandlers({ ...dataSource(), getDevice });
    const response = mockResponse();

    await local.get(request({ params: { id: DEVICE_ID } }), response.res);

    expect(response.statusCode).toBe(404);
  });

  it('returns a device to its owner', async () => {
    const getDevice = jest.fn().mockResolvedValue(record());
    const local = createDevicesHandlers({ ...dataSource(), getDevice });
    const response = mockResponse();

    await local.get(request({ params: { id: DEVICE_ID } }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: DEVICE_ID,
      userId: 'user-1',
      deviceName: 'Laptop',
      isActive: true,
    });
  });

  it('rejects a malformed device id', async () => {
    const getDevice = jest.fn();
    const local = createDevicesHandlers({ ...dataSource(), getDevice });
    const response = mockResponse();

    await local.get(request({ params: { id: 'not-an-id' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(getDevice).not.toHaveBeenCalled();
  });

  it('always attributes a new device to the authenticated user', async () => {
    const createDevice = jest.fn().mockResolvedValue(record());
    const local = createDevicesHandlers({ ...dataSource(), createDevice });
    const response = mockResponse();

    await local.create(
      request({ body: { userId: 'attacker', deviceName: 'Laptop' } }),
      response.res,
    );

    expect(createDevice).toHaveBeenCalledWith({ userId: 'user-1', deviceName: 'Laptop' });
    expect(response.statusCode).toBe(201);
  });

  it('rejects an invalid device payload without writing', async () => {
    const createDevice = jest.fn();
    const local = createDevicesHandlers({ ...dataSource(), createDevice });
    const response = mockResponse();

    await local.create(request({ body: { platform: 'solaris' } }), response.res);

    expect(response.statusCode).toBe(400);
    expect(createDevice).not.toHaveBeenCalled();
  });

  it('updates an owned device with the validated patch only', async () => {
    const getDevice = jest.fn().mockResolvedValue(record());
    const updateDevice = jest.fn().mockResolvedValue(record({ deviceName: 'Renamed' }));
    const local = createDevicesHandlers({ ...dataSource(), getDevice, updateDevice });
    const response = mockResponse();

    await local.update(
      request({ params: { id: DEVICE_ID }, body: { deviceName: 'Renamed', userId: 'attacker' } }),
      response.res,
    );

    expect(updateDevice).toHaveBeenCalledWith(DEVICE_ID, { deviceName: 'Renamed' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects an empty update patch', async () => {
    const updateDevice = jest.fn();
    const local = createDevicesHandlers({ ...dataSource(), updateDevice });
    const response = mockResponse();

    await local.update(request({ params: { id: DEVICE_ID }, body: {} }), response.res);

    expect(response.statusCode).toBe(400);
    expect(updateDevice).not.toHaveBeenCalled();
  });

  it('refuses to update a device owned by another user', async () => {
    const getDevice = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const updateDevice = jest.fn();
    const local = createDevicesHandlers({ ...dataSource(), getDevice, updateDevice });
    const response = mockResponse();

    await local.update(
      request({ params: { id: DEVICE_ID }, body: { deviceName: 'Renamed' } }),
      response.res,
    );

    expect(response.statusCode).toBe(404);
    expect(updateDevice).not.toHaveBeenCalled();
  });

  it('deletes an owned device', async () => {
    const getDevice = jest.fn().mockResolvedValue(record());
    const deleteDevice = jest.fn().mockResolvedValue(true);
    const local = createDevicesHandlers({ ...dataSource(), getDevice, deleteDevice });
    const response = mockResponse();

    await local.delete(request({ params: { id: DEVICE_ID } }), response.res);

    expect(deleteDevice).toHaveBeenCalledWith(DEVICE_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('refuses to delete a device owned by another user', async () => {
    const getDevice = jest.fn().mockResolvedValue(record({ userId: 'user-2' }));
    const deleteDevice = jest.fn();
    const local = createDevicesHandlers({ ...dataSource(), getDevice, deleteDevice });
    const response = mockResponse();

    await local.delete(request({ params: { id: DEVICE_ID } }), response.res);

    expect(response.statusCode).toBe(404);
    expect(deleteDevice).not.toHaveBeenCalled();
  });

  it('surfaces a storage failure as a 500', async () => {
    const listDevices = jest.fn().mockRejectedValue(new Error('boom'));
    const local = createDevicesHandlers({ ...dataSource(), listDevices });
    const response = mockResponse();

    await local.list(request(), response.res);

    expect(response.statusCode).toBe(500);
  });
});
