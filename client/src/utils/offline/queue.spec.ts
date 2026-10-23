import type { OfflinePendingSendRecord } from './db';
import type { OfflineQueue } from './queue';
import { createOfflineQueue } from './queue';
import { createMemoryStore } from './db';

const makeHarness = (options?: {
  online?: () => boolean;
  send?: jest.Mock;
  now?: () => number;
}) => {
  const store = createMemoryStore();
  let idCounter = 0;
  let nowCounter = 0;
  const send: jest.Mock = options?.send ?? jest.fn(async () => undefined);
  const queue: OfflineQueue = createOfflineQueue({
    store,
    send,
    isOnline: options?.online ?? (() => true),
    now: options?.now ?? (() => ++nowCounter),
    createId: () => `item-${++idCounter}`,
  });
  return { store, send, queue };
};

describe('offline queue', () => {
  it('enqueues a send while offline and surfaces it as pending', async () => {
    const { queue } = makeHarness({ online: () => false });

    const item = await queue.enqueue({ text: 'hello offline', conversationId: 'convo-1' });

    expect(item.status).toBe('pending');
    expect(item.conversationId).toBe('convo-1');
    expect(item.attempts).toBe(0);

    const pending = await queue.list();
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe('hello offline');
  });

  it('does not drain while offline and leaves every item queued', async () => {
    const { queue, send } = makeHarness({ online: () => false });
    await queue.enqueue({ text: 'one', conversationId: 'convo-1' });
    await queue.enqueue({ text: 'two', conversationId: 'convo-1' });

    const result = await queue.flush({ conversationId: 'convo-1' });

    expect(send).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
    expect(result.remaining).toHaveLength(2);
  });

  it('flushes sequentially in enqueue order on reconnect and removes confirmed items', async () => {
    const { queue, send, store } = makeHarness();
    const seen: string[] = [];
    send.mockImplementation(async (item: { text: string }) => {
      seen.push(item.text);
    });

    await queue.enqueue({ text: 'first', conversationId: 'convo-1' });
    await queue.enqueue({ text: 'second', conversationId: 'convo-1' });
    await queue.enqueue({ text: 'third', conversationId: 'convo-1' });

    const result = await queue.flush({ conversationId: 'convo-1' });

    expect(seen).toEqual(['first', 'second', 'third']);
    expect(result.sent).toHaveLength(3);
    expect(result.failed).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(await store.listPendingSends()).toEqual([]);
  });

  it('retains a failed item and stops so later messages do not overtake it', async () => {
    const { queue, send, store } = makeHarness();
    send.mockImplementation(async (item: { text: string }) => {
      if (item.text === 'second') {
        throw new Error('network down');
      }
    });

    await queue.enqueue({ text: 'first', conversationId: 'convo-1' });
    await queue.enqueue({ text: 'second', conversationId: 'convo-1' });
    await queue.enqueue({ text: 'third', conversationId: 'convo-1' });

    const result = await queue.flush({ conversationId: 'convo-1' });

    expect(result.sent).toEqual(['item-1']);
    expect(result.failed).toEqual(['item-2']);
    expect(send).toHaveBeenCalledTimes(2);

    const remaining = await queue.list();
    expect(remaining.map((item) => item.text)).toEqual(['second', 'third']);
    const failed = remaining[0];
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('network down');
    expect(failed.attempts).toBe(1);

    const records = await store.listPendingSends();
    expect(records).toHaveLength(2);
  });

  it('retries a failed item on the next flush and clears it once accepted', async () => {
    const { queue, send } = makeHarness();
    let attempts = 0;
    send.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('still offline');
      }
    });

    await queue.enqueue({ text: 'retry me', conversationId: 'convo-1' });
    await queue.flush({ conversationId: 'convo-1' });
    expect((await queue.list())[0].status).toBe('failed');

    const second = await queue.flush({ conversationId: 'convo-1' });
    expect(second.sent).toHaveLength(1);
    expect(await queue.list()).toEqual([]);
  });

  it('treats a handler that returns false as a retained failure', async () => {
    const { queue } = makeHarness({ send: jest.fn(async () => false) });
    await queue.enqueue({ text: 'refused', conversationId: 'convo-1' });

    const result = await queue.flush({ conversationId: 'convo-1' });

    expect(result.failed).toHaveLength(1);
    expect((await queue.list())[0].status).toBe('failed');
  });

  it('drains only the requested conversation and leaves the rest queued', async () => {
    const { queue, send } = makeHarness();
    await queue.enqueue({ text: 'a', conversationId: 'convo-1' });
    await queue.enqueue({ text: 'b', conversationId: 'convo-2' });

    const result = await queue.flush({ conversationId: 'convo-2' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.sent).toHaveLength(1);
    expect((await queue.list()).map((item) => item.text)).toEqual(['a']);
  });

  it('deduplicates concurrent flushes so an item is sent once', async () => {
    const { queue, send } = makeHarness();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    send.mockImplementation(async () => {
      await gate;
    });
    await queue.enqueue({ text: 'once', conversationId: 'convo-1' });

    const first = queue.flush({ conversationId: 'convo-1' });
    const second = queue.flush({ conversationId: 'convo-1' });
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent).toEqual(b.sent);
  });

  it('recovers items stuck in "sending" after a crash as pending', async () => {
    const { store, queue } = makeHarness({ online: () => false });
    const stuck: OfflinePendingSendRecord = {
      id: 'stuck',
      draftId: 'convo-1',
      conversationId: 'convo-1',
      text: 'interrupted',
      createdAt: 1,
      attempts: 1,
      status: 'sending',
    };
    await store.putPendingSend(stuck);

    const pending = await queue.list();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
  });

  it('removeForDraft drops queued items for a draft that was sent normally', async () => {
    const { queue } = makeHarness();
    await queue.enqueue({ text: 'a', draftId: 'draft-1' });
    await queue.enqueue({ text: 'b', draftId: 'draft-2' });

    const removed = await queue.removeForDraft('draft-1');

    expect(removed).toBe(1);
    expect((await queue.list()).map((item) => item.draftId)).toEqual(['draft-2']);
  });

  it('notifies subscribers as items move through the queue', async () => {
    const { queue } = makeHarness();
    const seen: number[] = [];
    const unsubscribe = queue.subscribe((items) => seen.push(items.length));

    await queue.enqueue({ text: 'a', conversationId: 'convo-1' });
    await queue.flush({ conversationId: 'convo-1' });
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen[0]).toBe(0);
    expect(seen).toContain(1);
    expect(seen[seen.length - 1]).toBe(0);
  });
});
