import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageGenDialog from '../ImageGenDialog';

const mockAttachFiles = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/hooks/Files/useFileUploadRouter', () => () => mockAttachFiles);

describe('ImageGenDialog', () => {
  beforeEach(() => {
    mockAttachFiles.mockClear();
    global.URL.createObjectURL = jest.fn(() => 'blob:generated');
    global.URL.revokeObjectURL = jest.fn();
    (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue(
      response({
        ok: true,
        blob: new Blob(['PNG fake'], { type: 'image/png' }),
      }),
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** jsdom has no fetch/Response globals; the dialog calls ok/json()/blob(). */
  const response = ({
    ok,
    json,
    blob,
  }: {
    ok: boolean;
    json?: unknown;
    blob?: Blob;
  }) => ({
    ok,
    status: ok ? 200 : 402,
    json: async () => json ?? {},
    blob: async () => blob ?? new Blob(),
  }) as unknown as Response;

  it('generates an image and previews it', async () => {
    const post = jest.mocked(global.fetch);
    post.mockResolvedValueOnce(
      response({
        ok: true,
        blob: new Blob(['PNG fake'], { type: 'image/png' }),
      }),
    );
    render(<ImageGenDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a sunrise over water' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_image_gen_generate' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/images/generate', expect.anything());
      expect(screen.getByRole('img', { name: 'a sunrise over water' })).toHaveAttribute(
        'src',
        'blob:generated',
      );
    });
    post.mockRestore();
  });

  it('surfaces the server message on cap/config errors', async () => {
    const post = jest.mocked(global.fetch);
    post.mockResolvedValueOnce(
      response({
        ok: false,
        json: Promise.resolve({ message: 'Daily image limit reached (5/day)' }),
      }),
    );
    render(<ImageGenDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_image_gen_generate' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Daily image limit reached (5/day)');
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    post.mockRestore();
  });

  it('hands the generated blob to the standard file pipeline', async () => {
    const post = jest.mocked(global.fetch);
    post.mockResolvedValueOnce(
      response({
        ok: true,
        blob: new Blob(['jpegdata'], { type: 'image/jpeg' }),
      }),
    );
    render(<ImageGenDialog open onClose={jest.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sunset' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_image_gen_generate' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'com_ui_image_gen_add' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_image_gen_add' }));
    await waitFor(() => {
      expect(mockAttachFiles).toHaveBeenCalledWith([expect.objectContaining({ type: 'image/jpeg' })]);
    });
    expect(mockAttachFiles.mock.calls[0][0][0]).toBeInstanceOf(File);
    post.mockRestore();
  });
});
