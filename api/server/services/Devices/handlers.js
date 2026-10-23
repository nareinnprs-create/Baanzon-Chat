const { createDevicesHandlers } = require('@librechat/api');
const { createDevice, getDevice, listDevices, updateDevice, deleteDevice } = require('~/models');

const handlers = createDevicesHandlers({
  createDevice,
  getDevice,
  listDevices,
  updateDevice,
  deleteDevice,
});

module.exports = { handlers };
