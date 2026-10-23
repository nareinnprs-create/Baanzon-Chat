const { createSubscriptionsHandlers } = require('@librechat/api');
const {
  createSubscription,
  getSubscription,
  listSubscriptions,
  updateSubscription,
  deleteSubscription,
} = require('~/models');

const handlers = createSubscriptionsHandlers({
  createSubscription,
  getSubscription,
  listSubscriptions,
  updateSubscription,
  deleteSubscription,
});

module.exports = { handlers };
