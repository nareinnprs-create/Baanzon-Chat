import { v4 } from 'uuid';
import { dataService } from 'librechat-data-provider';
import type { TConversation, TFile } from 'librechat-data-provider';

/** Typed image requests: the interception fires when the message opens with
 *  an unmistakable generate-image phrasing. Image nouns are word-bounded so
 *  phrases like "fix the image carousel bug" stay plain chat, and drawing
 *  verbs (draw/paint/sketch) intercept on their own with a blocklist that
 *  keeps non-visual idioms ("draw conclusions", "sketch the architecture")
 *  in plain chat. */
const IMAGE_NOUNS =
  'image|images|picture|pictures|photos?|photographs?|art|artwork|drawing|drawings|painting|paintings|sketch|sketches|illustration|illustrations|wallpapers?|logo|logos|icon|icons|poster|posters|banner|banners|avatar|avatars|mockups?|backgrounds?|tattoo|portrait';

const IMAGE_CORE_RE =
  new RegExp(
    '^(?:generate|create|make|draw|paint|render|produce|design|sketch|doodle)\\s+(?:me\\s+)?(?:an?\\s+|some\\s+|the\\s+)?\\b(?:' +
      IMAGE_NOUNS +
      ')\\b(?:$|\\s+(?:of|about|with|showing|featuring|depicting|from|for|in|on)\\b|\\s*:|,)',
    'i',
  );

const IMAGE_PREFIX_RE =
  /^(?:(?:hey|hi|hello)[,!.]?\s*)?(?:(?:please|pls)[,.!]?\s*)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:i\s+(?:want|need|would\s+like)\s+(?:you\s+)?(?:to\s+)?)?/i;

/** Objects that turn drawing verbs into non-visual idioms ("draw
 *  conclusions", "paint a bleak picture with words"). */
const DRAW_BLOCK_RE =
  /^\s*(?:an?\s+|the\s+|some\s+)?(?:conclusions?|attention|data|blood|strength|inspiration|straws?|blanks?|architecture|ideas?|concepts?|outline|line|distinction|contrast|parallel|picture with words|from)\b/i;

export function isImageRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const stripped = trimmed.replace(IMAGE_PREFIX_RE, '');
  if (/^(?:draw|paint|sketch|doodle)\b/i.test(stripped)) {
    const rest = stripped.replace(/^(?:draw|paint|sketch|doodle)\b\s*/i, '');
    return !DRAW_BLOCK_RE.test(rest);
  }
  return IMAGE_CORE_RE.test(stripped);
}

/** Error subtype carrying the server's own message (daily cap, burst limit,
 *  not-configured) so callers can surface it instead of a generic string. */
export type ImageGenError = Error & { serverMessage?: string };

/** POSTs the prompt to the tier-gated generation endpoint and wraps the blob
 *  as a File, the same shape the ImageGenDialog hands to the file pipeline.
 *  The endpoint is requireJwtAuth'd; the access token comes from the caller's
 *  auth context (same pattern as the Diya turn request). */
export async function generateImageFile(prompt: string, token?: string): Promise<File> {
  const res = await fetch('/api/images/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    let message = 'Image generation failed';
    try {
      const data = await res.json();
      if (typeof data?.message === 'string') {
        message = data.message;
      }
    } catch {
      // non-JSON error body: keep the generic message
    }
    const error: ImageGenError = new Error(message);
    error.serverMessage = message;
    throw error;
  }
  const blob = await res.blob();
  const mime = blob.type || 'image/png';
  let extension = 'img';
  if (mime.includes('jpeg')) {
    extension = 'jpg';
  } else if (mime.includes('png')) {
    extension = 'png';
  }
  const filename = `baanzon-image-${Date.now()}.${extension}`;
  return new File([blob], filename, { type: mime });
}

/** Uploads a generated image file into the conversation's file pipeline and
 *  returns the stored TFile (same shape a manual upload produces). */
export async function uploadGeneratedImage({
  file,
  conversation,
  isTemporary,
}: {
  file: File;
  conversation: TConversation | null | undefined;
  isTemporary: boolean;
}): Promise<TFile> {
  let width = 0;
  let height = 0;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  }
  const formData = new FormData();
  formData.append('endpoint', conversation?.endpoint ?? '');
  formData.append('endpointType', conversation?.endpointType ?? '');
  formData.append('file', file, encodeURIComponent(file.name));
  formData.append('file_id', v4());
  if (width) {
    formData.append('width', width.toString());
  }
  if (height) {
    formData.append('height', height.toString());
  }
  formData.append('message_file', 'true');
  if (isTemporary) {
    formData.append('isTemporary', 'true');
  }
  return dataService.uploadImage(formData);
}
