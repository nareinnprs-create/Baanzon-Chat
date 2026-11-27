const { logger } = require('@librechat/data-schemas');
const mongoose = require('mongoose');
const { generate2FATempToken } = require('~/server/services/twoFactorService');
const { setAuthTokens } = require('~/server/services/AuthService');

const loginController = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    /** Ops suspension is a persistent flag, checked before any token is issued. */
    const suspended = await mongoose.connection.db
      ?.collection('users')
      .findOne({ _id: req.user._id }, { projection: { suspended: 1 } });
    if (suspended?.suspended === true) {
      return res.status(403).json({ message: 'This account has been suspended.' });
    }

    if (req.user.twoFactorEnabled) {
      const tempToken = generate2FATempToken(req.user._id);
      return res.status(200).json({ twoFAPending: true, tempToken });
    }

    const { password: _p, totpSecret: _t, __v, ...user } = req.user;
    user.id = user._id.toString();

    const token = await setAuthTokens(req.user._id, res, null, req);

    return res.status(200).send({ token, user });
  } catch (err) {
    logger.error('[loginController]', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

module.exports = {
  loginController,
};
