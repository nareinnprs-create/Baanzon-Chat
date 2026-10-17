const { isEnabled, isInviteOnlyRegistration } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');

async function validateRegistration(req, res, next) {
  if (req.invite) {
    return next();
  }

  const appConfig = await getAppConfig({});
  if (isInviteOnlyRegistration({ registration: appConfig?.registration })) {
    return res.status(403).json({
      message: 'Registration is not allowed.',
    });
  }

  if (isEnabled(process.env.ALLOW_REGISTRATION)) {
    next();
  } else {
    return res.status(403).json({
      message: 'Registration is not allowed.',
    });
  }
}

module.exports = validateRegistration;
