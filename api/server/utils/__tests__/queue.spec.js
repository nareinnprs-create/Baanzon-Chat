const { LB_QueueAsyncCall } = require('../queue');

describe('LB_QueueAsyncCall', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    // Drain anything left over so the module-level interval is cleared before the next test.
    await jest.advanceTimersByTimeAsync(1000);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('executes a queued async function and delivers its result to the callback', async () => {
    const asyncFunc = jest.fn().mockResolvedValue('ok');
    const callback = jest.fn();

    LB_QueueAsyncCall(asyncFunc, [1, 2], callback);
    await jest.advanceTimersByTimeAsync(20);

    expect(asyncFunc).toHaveBeenCalledWith(1, 2);
    expect(callback).toHaveBeenCalledWith(null, 'ok');
  });

  it('passes a rejection to the callback', async () => {
    const error = new Error('boom');
    const asyncFunc = jest.fn().mockRejectedValue(error);
    const callback = jest.fn();

    LB_QueueAsyncCall(asyncFunc, [], callback);
    await jest.advanceTimersByTimeAsync(20);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(error);
  });

  it('drains queued calls in FIFO order', async () => {
    const order = [];
    const callbacks = [jest.fn(), jest.fn(), jest.fn()];
    const make = (id) =>
      jest.fn(async () => {
        order.push(id);
        return id;
      });

    LB_QueueAsyncCall(make('a'), [], callbacks[0]);
    LB_QueueAsyncCall(make('b'), [], callbacks[1]);
    LB_QueueAsyncCall(make('c'), [], callbacks[2]);

    await jest.advanceTimersByTimeAsync(60);

    expect(order).toEqual(['a', 'b', 'c']);
    expect(callbacks[0]).toHaveBeenCalledWith(null, 'a');
    expect(callbacks[1]).toHaveBeenCalledWith(null, 'b');
    expect(callbacks[2]).toHaveBeenCalledWith(null, 'c');
  });

  it('stops the interval once the queue drains', async () => {
    const callback = jest.fn();

    LB_QueueAsyncCall(jest.fn().mockResolvedValue(1), [], callback);
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(100);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
