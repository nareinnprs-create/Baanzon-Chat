import { render, screen, fireEvent } from '@testing-library/react';
import type { CanvasComment, CanvasSelection } from '../types';
import type { TOptions } from 'i18next';
import { CANVAS_LABELS } from '../labels';
import CommentsPanel from '../CommentsPanel';
import i18n from '~/locales/i18n';

const t = i18n.t.bind(i18n) as (key: string, options?: TOptions) => string;
const L = Object.fromEntries(
  Object.entries(CANVAS_LABELS).map(([name, key]) => [name, t(key)]),
) as Record<keyof typeof CANVAS_LABELS, string>;
const anchored = (quote: string) => t(CANVAS_LABELS.commentAnchored, { quote });

function makeComment(overrides: Partial<CanvasComment> = {}): CanvasComment {
  return {
    id: 'comment-1',
    blockId: 'block-1',
    anchor: { start: 0, end: 5, text: 'Hello' },
    body: 'Please reword',
    author: 'You',
    createdAt: '2026-01-01T00:00:00.000Z',
    resolved: false,
    ...overrides,
  };
}

function renderPanel(comments: CanvasComment[], selection: CanvasSelection | null = null) {
  const handlers = {
    onAdd: jest.fn(),
    onResolve: jest.fn(),
    onReopen: jest.fn(),
    onDelete: jest.fn(),
  };
  render(<CommentsPanel comments={comments} selection={selection} {...handlers} />);
  return handlers;
}

describe('CommentsPanel', () => {
  it('renders the empty state when there are no comments', () => {
    renderPanel([]);
    expect(screen.getByText(L.commentsEmptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('adds a comment with the current selection and clears the composer', () => {
    const selection: CanvasSelection = {
      blockId: 'block-1',
      start: 0,
      end: 5,
      text: 'Hello',
    };
    const handlers = renderPanel([], selection);

    expect(screen.getByText(anchored('Hello'))).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: L.addComment });
    expect(addButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(L.commentComposerLabel), {
      target: { value: '  Nice work  ' },
    });
    expect(addButton).toBeEnabled();
    fireEvent.click(addButton);

    expect(handlers.onAdd).toHaveBeenCalledWith('Nice work', selection);
    expect(screen.getByLabelText(L.commentComposerLabel)).toHaveValue('');
  });

  it('resolves an unresolved comment', () => {
    const handlers = renderPanel([makeComment({ resolved: false })]);
    fireEvent.click(screen.getByRole('button', { name: L.resolveComment }));
    expect(handlers.onResolve).toHaveBeenCalledWith('comment-1');
  });

  it('reopens a resolved comment', () => {
    const handlers = renderPanel([makeComment({ resolved: true })]);
    expect(screen.getByText(L.commentResolved)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: L.reopenComment }));
    expect(handlers.onReopen).toHaveBeenCalledWith('comment-1');
  });

  it('deletes a comment', () => {
    const handlers = renderPanel([makeComment()]);
    fireEvent.click(screen.getByRole('button', { name: L.deleteComment }));
    expect(handlers.onDelete).toHaveBeenCalledWith('comment-1');
  });

  it('labels a comment with no anchor as document-level', () => {
    const selection: CanvasSelection = { blockId: 'block-1', start: 0, end: 5, text: 'Hello' };
    renderPanel([makeComment({ anchor: null })], selection);
    expect(screen.getByText(L.commentNoAnchor)).toBeInTheDocument();
    expect(screen.getByText(anchored('Hello'))).toBeInTheDocument();
  });
});
