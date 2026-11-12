import type { TConversation } from 'librechat-data-provider';
import { generateImageFile, isImageRequest, uploadGeneratedImage } from './imageIntent';

const mockFetch = jest.fn();
const mockUploadImage = jest.fn();

jest.mock('librechat-data-provider', () => ({
  dataService: { uploadImage: (...args: unknown[]) => mockUploadImage(...args) },
}));

describe('isImageRequest', () => {
  it.each([
    ['generate an image of a cat', true],
    ['Generate an image of a cat', true],
    ['generate image of sunset', true],
    ['generate images of cats', true],
    ['create a picture of mountains', true],
    ['draw a photo of the beach', true],
    ['please generate an image', true],
    ['can you generate an image of London', true],
    ['hey, generate an image', true],
    ['make me a picture', true],
    ['i want to generate an image', true],
    ['generate an image', true],
    ['hello', false],
    ['tell me about photosynthesis', false],
    ['fix the image carousel bug', false],
    ['generate an image gallery component', false],
    ['generated images are wrong', false],
    ['what is an image?', false],
    ['', false],
  ])('%s → %s', (text, expected) => {
    expect(isImageRequest(text)).toBe(expected);
  });
});

describe('generateImageFile', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('wraps the generated blob as a File', async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'image/png' }),
    });

    const file = await generateImageFile('a cat');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/images/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(file.type).toBe('image/png');
    expect(file.name).toMatch(/^baanzon-image-\d+\.png$/);
  });

  it('carries the server message on rejection', async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Too many images this minute — try again shortly.' }),
    });

    await expect(generateImageFile('a cat')).rejects.toMatchObject({
      serverMessage: 'Too many images this minute — try again shortly.',
    });
  });
});

describe('uploadGeneratedImage', () => {
  afterEach(() => {
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  });

  it('builds the upload FormData with image routing fields', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => ({
      width: 512,
      height: 256,
      close: () => undefined,
    });
    const file = new File(['x'], 'img.png', { type: 'image/png' });

    await uploadGeneratedImage({
      file,
      conversation: { endpoint: 'Opraiz' } as unknown as TConversation,
      isTemporary: true,
    });

    const formData = mockUploadImage.mock.calls[0][0] as FormData;
    expect(formData.get('endpoint')).toBe('Opraiz');
    expect(formData.get('endpointType')).toBe('');
    expect(formData.get('file_id')).toBeTruthy();
    expect(formData.get('width')).toBe('512');
    expect(formData.get('height')).toBe('256');
    expect(formData.get('message_file')).toBe('true');
    expect(formData.get('isTemporary')).toBe('true');
    expect(formData.get('file')).toBeTruthy();
  });
});
