const { createUsageRecordsHandlers } = require('@librechat/api');
const {
  createUsageRecord,
  getUsageRecord,
  listUsageRecords,
  updateUsageRecord,
  deleteUsageRecord,
} = require('~/models');

const handlers = createUsageRecordsHandlers({
  createUsageRecord,
  getUsageRecord,
  listUsageRecords,
  updateUsageRecord,
  deleteUsageRecord,
});

module.exports = { handlers };
