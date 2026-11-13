import { createPushDispatcher } from './index';
import type { PushSubscriptionLean } from '@librechat/data-schemas';

function makeSub(endpoint: string): PushSubscriptionLean {
  return {
    _id: endpoint as never,
    userId: 'u1' as never,
    endpoint,
    keys: { p256dh: 'k', auth: 'a' },
  };
}

function makeDeps(subs: PushSubscriptionLean[]) {
  const deleted: string[] = [];
  const sent: { endpoint: string; payload: string }[] = [];
  const send = jest.fn(async (subscription: { endpoint: string }, payload: string) => {
    const err = new Error('send') as Error & { statusCode?: number };
    if (subscription.endpoint.endsWith('#410')) {
      err.statusCode = 410;
      throw err;
    }
    if (subscription.endpoint.endsWith('#gone')) {
      err.statusCode = 404;
      throw err;
    }
    sent.push({ endpoint: subscription.endpoint, payload });
  });
  const deps = {
    subscriptions: {
      listPushSubscriptions: jest.fn(async () => subs),
      deletePushSubscriptionByEndpoint: jest.fn(async (endpoint: string) => {
        deleted.push(endpoint);
        return true;
      }),
    },
    send,
  };
  return { deps, deleted, sent };
}

describe('createPushDispatcher', () => {
  it('sends the JSON payload to every endpoint and reports the delivered count', async () => {
    const { deps, sent } = makeDeps([makeSub('https://push/a'), makeSub('https://push/b')]);
    const dispatcher = createPushDispatcher(deps);

    const delivered = await dispatcher.dispatch('u1', { title: 'Run finished', body: 'ok' });

    expect(delivered).toBe(2);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push/a', 'https://push/b']);
    expect(JSON.parse(sent[0].payload)).toEqual({ title: 'Run finished', body: 'ok' });
  });

  it('prunes endpoints the push service reports gone (404/410) and keeps the rest', async () => {
    const { deps, deleted } = makeDeps([
      makeSub('https://push/a'),
      makeSub('https://push/b#gone'),
      makeSub('https://push/c#410'),
    ]);
    const dispatcher = createPushDispatcher(deps);

    const delivered = await dispatcher.dispatch('u1', { title: 'Run finished' });

    expect(delivered).toBe(1);
    expect(deleted).toEqual(['https://push/b#gone', 'https://push/c#410']);
  });

  it('tolerates other send errors and listing failures without throwing', async () => {
    const { deps } = makeDeps([makeSub('https://push/fails')]);
    deps.send.mockRejectedValueOnce(new Error('network down'));
    const dispatcher = createPushDispatcher(deps);
    await expect(dispatcher.dispatch('u1', { title: 'x' })).resolves.toBe(0);

    deps.subscriptions.listPushSubscriptions.mockRejectedValueOnce(new Error('db'));
    await expect(dispatcher.dispatch('u1', { title: 'x' })).resolves.toBe(0);
  });
});
