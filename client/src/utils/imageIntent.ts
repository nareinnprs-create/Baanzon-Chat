import { v4 } from 'uuid';
import { dataService } from 'librechat-data-provider';
import type { TConversation, TFile } from 'librechat-data-provider';

/** Typed image requests: the interception only fires when the message opens
 *  with an unmistakable generate-image phrasing — the image noun must end the
 *  request or carry a connector ("of a cat", "showing X"), so messages that
 *  merely mention images ("fix the image carousel bug") stay plain chat. */
const IMAGE_CORE_RE =
  /^(?:generate|create|make|draw|paint|render|produce)\s+(?:me\s+)?(?:an?\s+|some\s+|the\s+)?(?:image|images|picture|pictures|photos?|photographs?)(?:$|\s+(?:of|about|with|showing|featuring|depicting|from)\b|\s*:|,)/i;

const IMAGE_PREFIX_RE =
  /^(?:(?:hey|hi|hello)[,!.]?\s*)?(?:(?:please|pls)[,.!]?\s*)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:i\s+(?:want|need|would\s+like)\s+(?:you\s+)?(?:to\s+)?)?/i;

export function isImageRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return IMAGE_CORE_RE.test(trimmed.replace(IMAGE_PREFIX_RE, ''));
}

/** Error subtype carrying the server's own message (daily cap, burst limit,
 *  not-configured) so callers can surface it instead of a generic string. */
export type ImageGenError = Error & { serverMessage?: string };

/** POSTs the prompt to the tier-gated generation endpoint and wraps the blob
 *  as a File, the same shape the ImageGenDialog hands to the file pipeline. */
export async function generateImageFile(prompt: string): Promise<File> {
  const res = await fetch('/api/images/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  return new File([blob], `baanzon-image-${Date.now()}.${extension}`, { type: mime });
}

/** Uploads a generated image through the standard `/files/images` pipeline so
 *  the message carries a real file id, exactly like a composer attachment. */
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
