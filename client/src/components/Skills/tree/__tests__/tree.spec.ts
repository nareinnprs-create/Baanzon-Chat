import type { TSkillNode } from 'librechat-data-provider';
import {
  buildNodeTree,
  flattenNodeTree,
  collectFolderPaths,
  splitNodePath,
  isValidNodeName,
  isSelfOrDescendantPath,
} from '../tree';

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

describe('buildNodeTree', () => {
  it('orders siblings by server order, folders first', () => {
    const nodes = [
      node({ _id: 'b.txt', name: 'b.txt', order: 2 }),
      node({ _id: 'scripts', name: 'scripts', type: 'folder', order: 0 }),
      node({ _id: 'a.txt', name: 'a.txt', order: 1 }),
    ];

    const branches = buildNodeTree(nodes);

    expect(branches.map((branch) => branch.node._id)).toEqual(['scripts', 'a.txt', 'b.txt']);
    expect(branches.map((branch) => branch.depth)).toEqual([0, 0, 0]);
  });

  it('nests children under their parent and assigns depth', () => {
    const nodes = [
      node({ _id: 'scripts', name: 'scripts', type: 'folder', order: 0 }),
      node({ _id: 'scripts/run.sh', name: 'run.sh', parentId: 'scripts', order: 0 }),
    ];

    const branches = buildNodeTree(nodes);

    expect(branches).toHaveLength(1);
    expect(branches[0].children).toHaveLength(1);
    expect(branches[0].children[0].node._id).toBe('scripts/run.sh');
    expect(branches[0].children[0].depth).toBe(1);
  });

  it('promotes orphans with a missing parent to the root', () => {
    const nodes = [node({ _id: 'scripts/run.sh', name: 'run.sh', parentId: 'scripts' })];

    const branches = buildNodeTree(nodes);

    expect(branches.map((branch) => branch.node._id)).toEqual(['scripts/run.sh']);
    expect(branches[0].depth).toBe(0);
  });
});

describe('flattenNodeTree', () => {
  it('walks depth-first in render order', () => {
    const nodes = [
      node({ _id: 'scripts', name: 'scripts', type: 'folder', order: 0 }),
      node({ _id: 'scripts/run.sh', name: 'run.sh', parentId: 'scripts', order: 0 }),
      node({ _id: 'SKILL.md', name: 'SKILL.md', order: 1 }),
    ];

    const flattened = flattenNodeTree(buildNodeTree(nodes));

    expect(flattened.map((branch) => branch.node._id)).toEqual([
      'scripts',
      'scripts/run.sh',
      'SKILL.md',
    ]);
  });
});

describe('collectFolderPaths', () => {
  it('returns folder ids only, sorted', () => {
    const nodes = [
      node({ _id: 'scripts', name: 'scripts', type: 'folder' }),
      node({ _id: 'assets', name: 'assets', type: 'folder' }),
      node({ _id: 'SKILL.md', name: 'SKILL.md' }),
    ];

    expect(collectFolderPaths(nodes)).toEqual(['assets', 'scripts']);
  });
});

describe('splitNodePath', () => {
  it('splits a nested path into parent and name', () => {
    expect(splitNodePath('scripts/lib/run.sh')).toEqual({
      parentId: 'scripts/lib',
      name: 'run.sh',
    });
  });

  it('treats a root file as parentless', () => {
    expect(splitNodePath('SKILL.md')).toEqual({ parentId: null, name: 'SKILL.md' });
  });

  it('strips leading and trailing slashes', () => {
    expect(splitNodePath('/scripts/run.sh/')).toEqual({ parentId: 'scripts', name: 'run.sh' });
  });
});

describe('isValidNodeName', () => {
  it.each(['run.sh', 'notes.txt', 'a b.md'])('accepts %s', (name) => {
    expect(isValidNodeName(name)).toBe(true);
  });

  it.each(['', '   ', '.', '..', 'a/b', 'SKILL.md', 'skill.md', 'SKILL.MD'])(
    'rejects %s',
    (name) => {
      expect(isValidNodeName(name)).toBe(false);
    },
  );
});

describe('isSelfOrDescendantPath', () => {
  it('matches the node itself', () => {
    expect(isSelfOrDescendantPath('scripts', 'scripts')).toBe(true);
  });

  it('matches descendants', () => {
    expect(isSelfOrDescendantPath('scripts/lib/run.sh', 'scripts')).toBe(true);
  });

  it('does not match a sibling sharing a prefix', () => {
    expect(isSelfOrDescendantPath('scripts-old/run.sh', 'scripts')).toBe(false);
  });
});
