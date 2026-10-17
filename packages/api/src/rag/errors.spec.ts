import { RagError, badRequest, forbidden, notFound, capacityExceeded } from './errors';

describe('RagError', () => {
  it('is an Error carrying the message and the declared status', () => {
    const error = new RagError('boom', 400);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RagError);
    expect(error.name).toBe('RagError');
    expect(error.message).toBe('boom');
    expect(error.status).toBe(400);
  });
});

describe('error factories', () => {
  it('badRequest carries the caller-supplied message at 400', () => {
    const error = badRequest('name is required');
    expect(error).toBeInstanceOf(RagError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('name is required');
  });

  it('forbidden defaults to "Forbidden" at 403', () => {
    expect(forbidden().status).toBe(403);
    expect(forbidden().message).toBe('Forbidden');
  });

  it('forbidden keeps a supplied message', () => {
    expect(forbidden('Collection scope not permitted').message).toBe(
      'Collection scope not permitted',
    );
  });

  it('notFound defaults to "Not Found" at 404', () => {
    expect(notFound().status).toBe(404);
    expect(notFound().message).toBe('Not Found');
  });

  it('notFound keeps a supplied message', () => {
    expect(notFound('Collection not found').message).toBe('Collection not found');
  });

  it('capacityExceeded is a 409 that discloses the caller-facing message', () => {
    const error = capacityExceeded('vector store is full (10 collections)');
    expect(error.status).toBe(409);
    expect(error.message).toBe('vector store is full (10 collections)');
  });
});
