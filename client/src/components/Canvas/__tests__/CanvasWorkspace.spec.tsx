import { createStore, Provider as JotaiProvider } from 'jotai';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CanvasWorkspaceProps } from '../CanvasWorkspace';
import type { TOptions } from 'i18next';
import type { CanvasBlock, CanvasDocument } from '../types';
import type { EditSelectionFn } from '../api';
import CanvasWorkspace from '../CanvasWorkspace';
import { CANVAS_LABELS } from '../labels';
import i18n from '~/locales/i18n';

const t = i18n.t.bind(i18n) as (key: string, options?: TOptions) => string;
const L = Object.fromEntries(
  Object.entries(CANVAS_LABELS).map(([name, key]) => [name, t(key)]),
) as Record<keyof typeof CANVAS_LABELS, string>;
const blockName = (index: number) => t(CANVAS_LABELS.blockLabel, { index });

function makeBlock(id: string, text: string): CanvasBlock {
  return { id, kind: 'paragraph', text };
}

function makeDocument(blocks: CanvasBlock[]): CanvasDocument {
  return { id: 'document-1', title: 'Doc', blocks };
}

const noopEdit: EditSelectionFn = jest.fn(async () => []);

function renderWorkspace(props: Partial<CanvasWorkspaceProps> = {}) {
  const store = createStore();
  return render(
    <JotaiProvider store={store}>
      <CanvasWorkspace editSelection={noopEdit} {...props} />
    </JotaiProvider>,
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CanvasWorkspace', () => {
  it('renders the empty state with a call to add the first block', () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: L.featureTitle })).toBeInTheDocument();
    expect(screen.getByText(L.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.addFirstBlock })).toBeInTheDocument();
    expect(screen.queryByLabelText(blockName(1))).not.toBeInTheDocument();
  });

  it('creates a document from the empty state', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: L.addFirstBlock }));
    expect(screen.getByLabelText(blockName(1))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.addBlock })).toBeInTheDocument();
  });

  it('shows a loading state while the injected loader is pending', () => {
    const gate = deferred<CanvasDocument>();
    renderWorkspace({ loadDocument: () => gate.promise });

    expect(screen.getByRole('status')).toHaveTextContent(L.loading);
    expect(screen.queryByLabelText(blockName(1))).not.toBeInTheDocument();
  });

  it('renders the editing state and reflects typed block text', () => {
    renderWorkspace({ document: makeDocument([makeBlock('block-1', 'Hello')]) });

    const block = screen.getByLabelText(blockName(1));
    expect(block).toHaveValue('Hello');

    fireEvent.change(block, { target: { value: 'Hello world' } });
    expect(screen.getByLabelText(blockName(1))).toHaveValue('Hello world');

    fireEvent.click(screen.getByRole('button', { name: L.addBlock }));
    expect(screen.getByLabelText(blockName(2))).toBeInTheDocument();
  });

  it('enables undo after an edit and reverts it', () => {
    renderWorkspace({ document: makeDocument([makeBlock('block-1', 'Hello')]) });

    expect(screen.getByRole('button', { name: L.undo })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(blockName(1)), { target: { value: 'Changed' } });
    expect(screen.getByRole('button', { name: L.undo })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: L.undo }));
    expect(screen.getByLabelText(blockName(1))).toHaveValue('Hello');
  });

  it('surfaces a load failure and recovers through retry', async () => {
    const loadDocument = jest
      .fn()
      .mockRejectedValueOnce(new Error('Broken'))
      .mockResolvedValueOnce(makeDocument([makeBlock('block-1', 'Recovered')]));

    renderWorkspace({ loadDocument });

    expect(await screen.findByRole('alert')).toHaveTextContent('Broken');
    fireEvent.click(screen.getByRole('button', { name: L.retry }));

    expect(await screen.findByLabelText(blockName(1))).toHaveValue('Recovered');
    expect(loadDocument).toHaveBeenCalledTimes(2);
  });

  it('switches to the comments tab and shows the composer', () => {
    renderWorkspace({ document: makeDocument([makeBlock('block-1', 'Hello')]) });

    fireEvent.click(screen.getByRole('tab', { name: L.commentsTab }));
    expect(screen.getByLabelText(L.commentComposerLabel)).toBeInTheDocument();
  });
});
