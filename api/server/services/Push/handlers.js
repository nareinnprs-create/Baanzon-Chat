/**
 * Web Push wiring: web-push + VAPID keys from `.env` only (never committed).
 * The dispatcher is constructed here once per process, the way the
 * Notifications handlers construct their service. Without VAPID keys the
 * handlers still exist but report the feature as disabled.
 */
const webpush = require('web-push');
const { createPushDispatcher, createPushHandlers } = require('@librechat/api');
const {
  upsertPushSubscription,
  listPushSubscriptions,
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
} = require('~/models');

const publicKey = process.env.VAPID_PUBLIC_KEY || '';
const privateKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || 'mailto:support@baanzonchat.opraiz.com';
const configured = !!(publicKey && privateKey);

const subscriptions = {
  upsertPushSubscription,
  listPushSubscriptions,
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
};

let dispatcher = null;
let pushHandlers = createPushHandlers({ subscriptions });

if (configured) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
  dispatcher = createPushDispatcher({
    subscriptions,
    send: (subscription, payload) => webpush.sendNotification(subscription, payload),
  });
  pushHandlers = createPushHandlers({ subscriptions, dispatcher, publicKey });
}

module.exports = { pushHandlers, dispatcher, configured };
