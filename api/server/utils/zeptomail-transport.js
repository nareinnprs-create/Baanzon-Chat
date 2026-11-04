/**
 * ZeptoMail REST API transport for nodemailer.
 * Uses the Zoho-enczapikey header to send via ZeptoMail's transactional
 * email API — no SMTP auth needed.
 */
const https = require('https');

function zeptoMailTransport(apiKey, fromAddress, fromName) {
  return {
    name: 'zeptomail',
    version: '1.0.0',
    send(mail, callback) {
      const input = mail.data || {};
      const to = Array.isArray(input.to)
        ? input.to.map((x) => ({ email_address: { address: x.address || x } }))
        : [{ email_address: { address: input.to?.address || input.to } }];
      const body = JSON.stringify({
        from: { address: fromAddress, name: fromName },
        to,
        subject: input.subject || '(no subject)',
        htmlbody: input.html || input.text || '',
      });
      const req = https.request(
        {
          hostname: 'transactional.zeptomail.in',
          path: '/v1.1/email',
          method: 'POST',
          headers: {
            'Authorization': `Zoho-enczapikey ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) callback(null, { messageId: Date.now().toString(), envelope: {} });
            else callback(new Error(`ZeptoMail ${res.statusCode}: ${data.slice(0, 200)}`));
          });
        },
      );
      req.on('error', callback);
      req.write(body);
      req.end();
    },
  };
}

module.exports = function createTransport(config) {
  const key = config.pass || config.auth?.pass || '';
  const fromAddr = config.fromAddress || 'noreply@opraiz.com';
  const fromName = config.fromName || 'Baanzon Chat';
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport(zeptoMailTransport(key, fromAddr, fromName));
};
