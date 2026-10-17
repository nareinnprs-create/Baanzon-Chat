import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CanvasDocument, CanvasEditOperation, CanvasSelection } from '../types';
import type { EditSelectionFn } from '../api';
import { CANVAS_LABELS as L } from '../labels';
import CanvasEditor from '../CanvasEditor';

function makeDocument(): CanvasDocument {
  return {
    id: 'document-1',
    title: 'Doc',
    blocks: [{ id: 'block-1', kind: 'paragraph', text: 'Hello world' }],
  };
}

function _makeTwoBlockDocument(): CanvasDocument {
  return {
    id: 'document-1',
    title: 'Doc',
    blocks: [
      { id: 'block-1', kind: 'paragraph', text: 'First' },
      { id: 'block-2', kind: 'paragraph', text: 'Second' },
    ],
  };
}

const selection: CanvasSelection = { blockId: 'block-1', start: 0, end: 5, text: 'Hello' };

function renderEditor(editSelection: EditSelectionFn, current: CanvasSelection | null = null) {
  const handlers = {
    onTitleChange: jest.fn(),
    onBlockTextChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onOperations: jest.fn(),
  };
  render(
    <CanvasEditor
      document={makeDocument()}
      selection={current}
      editSelection={editSelection}
      {...handlers}
    />,
  );
  return handlers;
}

describe('CanvasEditor', () => {
  it('reports the selected range from a block textarea', () => {
    const handlers = renderEditor(jest.fn());
    const textarea = screen.getByLabelText('Block 1');
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 5);
    fireEvent.select(textarea);
    expect(handlers.onSelectionChange).toHaveBeenCalledWith(selection);
  });

  it('reports block text changes', () => {
    const handlers = renderEditor(jest.fn());
    fireEvent.change(screen.getByLabelText('Block 1'), { target: { value: 'Changed' } });
    expect(handlers.onBlockTextChange).toHaveBeenCalledWith('block-1', 'Changed');
  });

  it('hides the inline AI edit affordance without a selection', () => {
    renderEditor(jest.fn());
    expect(screen.queryByRole('group', { name: L.aiEdit })).not.toBeInTheDocument();
  });

  it('runs the injected edit and forwards the returned operations', async () => {
    const operations: CanvasEditOperation[] = [
      { type: 'replace_selection', blockId: 'block-1', start: 0, end: 5, text: 'Goodbye' },
    ];
    const editSelection = jest.fn(async () => operations);
    const handlers = renderEditor(editSelection, selection);

    fireEvent.change(screen.getByLabelText(L.aiEditInstructionLabel), {
      target: { value: 'uppercase' },
    });
    fireEvent.click(screen.getByRole('button', { name: L.aiEditApply }));

    await waitFor(() => expect(handlers.onOperations).toHaveBeenCalledWith(operations));
    expect(editSelection).toHaveBeenCalledWith(selection, 'uppercase', expect.anything());
    await waitFor(() => expect(screen.getByLabelText(L.aiEditInstructionLabel)).toHaveValue(''));
  });

  it('surfaces a failed edit with an alert', async () => {
    const editSelection = jest.fn(async () => {
      throw new Error('Nope');
    });
    renderEditor(editSelection, selection);

    fireEvent.change(screen.getByLabelText(L.aiEditInstructionLabel), {
      target: { value: 'polish' },
    });
    fireEvent.click(screen.getByRole('button', { name: L.aiEditApply }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope');
  });
});
