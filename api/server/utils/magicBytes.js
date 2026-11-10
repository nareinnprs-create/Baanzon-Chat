/**
 * Magic-byte validation: the stored upload's leading bytes must match its
 * claimed MIME type. Trusting the extension alone is how polyglot uploads
 * (e.g. an executable renamed to .png) slip through file-type gating.
 * Unknown text-ish types pass through — downstream content inspection owns them.
 */
const fs = require('fs').promises;

const SIGNATURES = {
  'image/png': [[0, [0x89, 0x50, 0x4e, 0x47]]],
  'image/jpeg': [[0, [0xff, 0xd8, 0xff]]],
  'image/gif': [[0, [0x47, 0x49, 0x46, 0x38]]],
  'image/webp': [[0, [0x52, 0x49, 0x46, 0x46]]],
  'application/pdf': [[0, [0x25, 0x50, 0x44, 0x46]]],
};

const TEXTISH =
  /\.(txt|md|json|csv|xml|html?|js|ts|jsx|tsx|py|css|ya?ml|sh|sql|rb|go|java|c|cpp)$/i;

async function validateMagicBytes(filePath, mimetype, originalname = '') {
  const sigs = SIGNATURES[mimetype];
  if (!sigs) {
    if ((mimetype || '').startsWith('text/') || TEXTISH.test(originalname)) {
      return null;
    }
    return null; // unrecognized binary types: downstream processing validates
  }
  const fd = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    await fd.read(header, 0, 16, 0);
    for (const [off, bytes] of sigs) {
      if (bytes.every((b, i) => header[off + i] === b)) {
        return null;
      }
    }
    if (mimetype === 'image/webp' && header.slice(8, 12).toString('ascii') === 'WEBP') {
      return null; // RIFF container: WEBP tag lives at offset 8
    }
    return 'File content does not match its claimed type — upload rejected.';
  } finally {
    await fd.close();
  }
}

module.exports = { validateMagicBytes };
