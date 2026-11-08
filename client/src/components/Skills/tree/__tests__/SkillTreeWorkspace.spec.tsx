import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { TSkillNode } from 'librechat-data-provider';
import SkillTreeWorkspace from '../SkillTreeWorkspace';
import { SKILL_TREE_LABELS } from '../labels';
import i18n from '~/locales/i18n';

const t = i18n.t.bind(i18n) as (k: string, o?: import('i18next').TOptions) => string;
const mockT = t;

const mockTreeQuery = jest.fn();
const mockSkillQuery = jest.fn();
const mockContentQuery = jest.fn();

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactMock = require('react');
  const passthrough =
    (tag: string, _displayName: string) =>
    ({ children, asChild: _a, variant: _v, size: _s, shape: _sh, ...rest }: any) => {
      const { ...props } = rest;
      return ReactMock.createElement(tag, props, children);
    };
  const Button = passthrough('button', 'Button');
  const Textarea = ReactMock.forwardRef((props: any, ref: any) =>
    ReactMock.createElement('textarea', { ...props, ref }),
  );
  const Input = ReactMock.forwardRef((props: any, ref: any) =>
    ReactMock.createElement('input', { ...props, ref }),
  );
  const Label = passthrough('label', 'Label');
  const OGDialog = ({ children, open }: any) =>
    open === false ? null : ReactMock.createElement(ReactMock.Fragment, null, children);
  const OGDialogContent = passthrough('div', 'OGDialogContent');
  const DropdownPopup = () => null;
  return {
    __esModule: true,
    Button,
    Textarea,
    Input,
    Label,
    OGDialog,
    OGDialogContent,
    DropdownPopup,
    Spinner: () => ReactMock.createElement('div', { 'data-testid': 'spinner' }),
    useToastContext: () => ({ showToast: jest.fn() }),
  };
});

jest.mock('~/data-provider', () => ({
  __esModule: true,
  useGetSkillQuery: (...args: unknown[]) => mockSkillQuery(...args),
  useGetSkillTreeQuery: (...args: unknown[]) => mockTreeQuery(...args),
  useGetSkillNodeContentQuery: (...args: unknown[]) => mockContentQuery(...args),
  useCreateSkillNodeMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateSkillNodeMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useDeleteSkillNodeMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUploadSkillFileMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateSkillNodeContentMutation: () => ({
    mutate: jest.fn(),
    isLoading: false,
    isError: false,
    variables: undefined,
    error: undefined,
  }),
}));

jest.mock('~/hooks', () => ({
  __esModule: true,
  useLocalize: () => (key: string, options?: import('i18next').TOptions) => mockT(key, options),
  useSkillPermissions: () => ({ canEdit: true, isLoading: false }),
}));

function node(partial: Partial<TSkillNode> & Pick<TSkillNode, '_id' | 'name'>): TSkillNode {
  return {
    skillId: 'skill-1',
    parentId: null,
    type: 'file',
    order: 0,
    author: 'user-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  };
}

function loadedTree(nodes: TSkillNode[]) {
  return {
    isLoading: false,
    isError: false,
    isFetching: false,
    data: { nodes },
    refetch: jest.fn(),
  };
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SkillTreeWorkspace skillId="skill-1" />
    </QueryClientProvider>,
  );
}

describe('SkillTreeWorkspace', () => {
  beforeEach(() => {
    mockSkillQuery.mockReturnValue({
      isLoading: false,
      data: { _id: 'skill-1', author: 'user-1' },
    });
    mockContentQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      data: { content: 'hello', mimeType: 'text/plain' },
      refetch: jest.fn(),
    });
  });

  it('shows a spinner while the tree loads', () => {
    mockTreeQuery.mockReturnValue({
      isLoading: true,
      isError: false,
      isFetching: false,
      data: undefined,
      refetch: jest.fn(),
    });

    renderWorkspace();

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('shows an empty state when the tree has no nodes', () => {
    mockTreeQuery.mockReturnValue(loadedTree([]));

    renderWorkspace();

    expect(screen.getByText(t(SKILL_TREE_LABELS.noFiles))).toBeInTheDocument();
  });

  it('renders nodes in server order with folders first', () => {
    mockTreeQuery.mockReturnValue(
      loadedTree([
        node({ _id: 'b.txt', name: 'b.txt', order: 2 }),
        node({ _id: 'scripts', name: 'scripts', type: 'folder', order: 0 }),
        node({ _id: 'a.txt', name: 'a.txt', order: 1 }),
      ]),
    );

    renderWorkspace();

    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.textContent)).toEqual(['scripts', 'a.txt', 'b.txt']);
  });

  it('expands folders by default, revealing nested files', () => {
    mockTreeQuery.mockReturnValue(
      loadedTree([
        node({ _id: 'scripts', name: 'scripts', type: 'folder', order: 0 }),
        node({ _id: 'scripts/run.sh', name: 'run.sh', parentId: 'scripts', order: 0 }),
      ]),
    );

    renderWorkspace();

    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.textContent)).toEqual(['scripts', 'run.sh']);
    expect(items[0]).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows an error state and retries on demand', () => {
    const refetch = jest.fn();
    mockTreeQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      isFetching: false,
      data: undefined,
      refetch,
    });

    renderWorkspace();

    expect(screen.getByText(t(SKILL_TREE_LABELS.treeLoadError))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('com_ui_retry') }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('loads node content when a file is selected', () => {
    mockTreeQuery.mockReturnValue(loadedTree([node({ _id: 'notes.txt', name: 'notes.txt' })]));

    renderWorkspace();

    fireEvent.click(within(screen.getByRole('treeitem')).getByRole('button'));

    expect(mockContentQuery).toHaveBeenCalledWith('skill-1', 'notes.txt', { retry: false });
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });
});
