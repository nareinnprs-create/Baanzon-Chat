const { createFeedbackHandlers } = require('@librechat/api');
const {
  createFeedback,
  getFeedback,
  listFeedback,
  updateFeedback,
  deleteFeedback,
} = require('~/models');

const handlers = createFeedbackHandlers({
  createFeedback,
  getFeedback,
  listFeedback,
  updateFeedback,
  deleteFeedback,
});

module.exports = { handlers };
