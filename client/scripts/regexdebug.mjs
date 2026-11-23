const IMAGE_NOUNS =
  'image|images|picture|pictures|photos?|photographs?|art|artwork|drawing|drawings|painting|paintings|sketch(?:es)?|illustration|illustrations|wallpapers?|logo|logos|icon|icons|poster|posters|banner|banners|avatar|avatars|mockups?|backgrounds?|tattoo|portrait|portrait';

const IMAGE_CORE_RE = new RegExp(
  '^(?:generate|create|make|draw|paint|render|produce|design|sketch|doodle)\\s+(?:me\\s+)?(?:an?\\s+|some\\s+|the\\s+)?\\b(?:' +
    IMAGE_NOUNS +
    ')\\b(?:$|\\s+(?:of|about|with|showing|featuring|depicting|from|for|in|on)\\b|\\s*:|,)',
  'i',
);

const IMAGE_PREFIX_RE =
  /^(?:(?:hey|hi|hello)[,!.]?\s*)?(?:(?:please|pls)[,.!]?\s*)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:i\s+(?:want|need|would\s+like)\s+(?:you\s+)?(?:to\s+)?)?/i;

const DRAW_VERB_RE =
  /^(?:draw|paint|sketch|doodle)\s+(?:me\s+)?(?:an?\s+|the\s+|some\s+)?(?!(?:conclusions?|attention|data|blood|strength|inspiration|straws?|blanks?|architecture|ideas?|concepts?|outline|a\s+(?:line|distinction|contrast|parallel|picture\s+with\s+words)|from)\b)\w+/i;

const text = 'sketch the architecture of the system';
const stripped = text.replace(IMAGE_PREFIX_RE, '');
console.log('stripped:', stripped);
console.log('CORE:', IMAGE_CORE_RE.test(stripped));
console.log('DRAW:', DRAW_VERB_RE.test(stripped));
