import { render, screen, fireEvent } from '@testing-library/react';
import type { CanvasDocument, CanvasVersion } from '../types';
import type { TOptions } from 'i18next';
import { CANVAS_LABELS } from '../labels';
import VersionHistory from '../VersionHistory';
import i18n from '~/locales/i18n';

const t = i18n.t.bind(i18n) as (key: string, options?: TOptions) => string;
const L = Object.fromEntries(
  Object.entries(CANVAS_LABELS).map(([name, key]) => [name, t(key)]),
) as Record<keyof typeof CANVAS_LABELS, string>;

function makeDocument(text: string): CanvasDocument {
  return { id: 'document-1', title: 'Doc', blocks: [{ id: 'block-1', kind: 'paragraph', text }] };
}

function makeVersion(id: string, label: string, text: string): CanvasVersion {
  return {
    id,
    label,
    createdAt: '2026-01-01T00:00:00.000Z',
    document: makeDocument(text),
  };
}

describe('VersionHistory', () => {
  it('renders the empty state when no versions exist', () => {
    render(
      <VersionHistory versions={[]} currentDocument={makeDocument('a')} onRestore={jest.fn()} />,
    );
    expect(screen.getByText(L.versionsEmptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('lists versions newest first with a diff summary against the current document', () => {
    render(
      <VersionHistory
        versions={[makeVersion('version-1', 'First', 'a'), makeVersion('version-2', 'Second', 'b')]}
        currentDocument={makeDocument('b')}
        onRestore={jest.fn()}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Second');
    expect(items[1]).toHaveTextContent('First');
    const diffs = screen.getAllByTestId('canvas-version-diff');
    expect(diffs[0]).toHaveTextContent(L.versionDiffUnchanged);
    expect(diffs[1]).toHaveTextContent(
      t(CANVAS_LABELS.versionDiffSummary, { added: 0, removed: 0, changed: 1 }),
    );
  });

  it('restores a version by id', () => {
    const onRestore = jest.fn();
    render(
      <VersionHistory
        versions={[makeVersion('version-1', 'First', 'a')]}
        currentDocument={makeDocument('b')}
        onRestore={onRestore}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: L.restoreVersion }));
    expect(onRestore).toHaveBeenCalledWith('version-1');
  });

  it('marks only the version matching the current document and disables its restore', () => {
    render(
      <VersionHistory
        versions={[makeVersion('version-1', 'First', 'a'), makeVersion('version-2', 'Second', 'b')]}
        currentDocument={makeDocument('b')}
        onRestore={jest.fn()}
      />,
    );
    expect(screen.getAllByText(L.versionCurrent)).toHaveLength(1);
    const restoreButtons = screen.getAllByRole('button', { name: L.restoreVersion });
    expect(restoreButtons[0]).toBeDisabled();
    expect(restoreButtons[1]).toBeEnabled();
  });

  it('creates and deletes versions through the optional handlers', () => {
    const onCreate = jest.fn();
    const onDelete = jest.fn();
    render(
      <VersionHistory
        versions={[makeVersion('version-1', 'First', 'a')]}
        currentDocument={makeDocument('b')}
        onCreate={onCreate}
        onRestore={jest.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: L.createVersion }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: L.deleteVersion }));
    expect(onDelete).toHaveBeenCalledWith('version-1');
  });
});
