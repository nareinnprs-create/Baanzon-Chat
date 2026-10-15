import { logger, validateRelativePath } from '@librechat/data-schemas';
import type {
  SkillTreeNode,
  RenameSkillNodeParams,
  RenameSkillNodeResult,
  DeleteSkillNodeParams,
  DeleteSkillNodeResult,
} from '@librechat/data-schemas';
import type { TSkillNode, TSkillTreeResponse } from 'librechat-data-provider';
import type { Response } from 'express';
import type { SkillsHandlersDeps } from './handlers';
import type { ServerRequest } from '~/types';
import { resolveDownloadPath } from '~/storage/path';
import { blockFilteredSkillFile } from './protection';
import { resolveSkillFilePathParam } from './path';
import { isBinaryBuffer } from './binary';

/**
 * Dependencies for the phase-2 skill-tree handlers. Everything is injected from
 * the legacy `/api` layer, so this module stays free of mongoose and storage
 * imports (mirrors `createSkillsHandlers` / `createSkillManagementHandlers`).
 */
export interface SkillTreeHandlersDeps {
  getSkillById: SkillsHandlersDeps['getSkillById'];
  getSkillFileByPath: SkillsHandlersDeps['getSkillFileByPath'];
  updateSkillFileContent: SkillsHandlersDeps['updateSkillFileContent'];
  getStrategyFunctions: SkillsHandlersDeps['getStrategyFunctions'];
  isValidObjectIdString: (value: unknown) => boolean;
  listSkillTree: (skillId: string) => Promise<SkillTreeNode[] | null>;
  renameSkillNode: (params: RenameSkillNodeParams) => Promise<RenameSkillNodeResult>;
  deleteSkillNode: (params: DeleteSkillNodeParams) => Promise<DeleteSkillNodeResult>;
  saveSkillFileContent: (input: {
    req: ServerRequest;
    skillId: string;
    relativePath: string;
    content: string;
    mimeType: string;
  }) => Promise<{ relativePath: string; bytes: number }>;
}

type ResolvedSkill = NonNullable<Awaited<ReturnType<SkillsHandlersDeps['getSkillById']>>>;

export type TreeRequest = ServerRequest & {
  resourceAccess?: { resourceInfo?: ResolvedSkill };
  file?: { buffer: Buffer; mimetype?: string; originalname?: string };
};

/**
 * Express handlers produced by {@link createSkillTreeHandlers}. Declared
 * explicitly (rather than inferred) so the module can be built with
 * `--isolatedDeclarations`, which cannot infer a shorthand object return.
 */
export interface SkillTreeHandlers {
  getTree: (req: TreeRequest, res: Response) => Promise<unknown>;
  createNode: (req: TreeRequest, res: Response) => Promise<unknown>;
  updateNode: (req: TreeRequest, res: Response) => Promise<unknown>;
  deleteNode: (req: TreeRequest, res: Response) => Promise<unknown>;
  getNodeContent: (req: TreeRequest, res: Response) => Promise<unknown>;
  updateNodeContent: (req: TreeRequest, res: Response) => Promise<unknown>;
}

const BODY_SKILL_PATH = 'SKILL.md';
const MAX_NODE_CONTENT_BYTES = 1024 * 1024;
const MAX_TEXT_CACHE_BYTES = 512 * 1024;

/** Mime types the tree editor treats as editable text (binaries use the files route). */
function isTextLikeMime(mime: string): boolean {
  if (mime === '' || mime.startsWith('text/')) return true;
  return (
    mime === 'application/json' ||
    mime.endsWith('+json') ||
    mime === 'application/xml' ||
    mime.endsWith('+xml') ||
    mime === 'application/yaml' ||
    mime === 'application/x-yaml' ||
    mime === 'application/javascript' ||
    mime === 'application/x-javascript' ||
    mime === 'application/x-sh'
  );
}

function toWireNode(node: SkillTreeNode): TSkillNode {
  return {
    _id: node._id,
    skillId: node.skillId,
    parentId: node.parentId,
    type: node.type,
    name: node.name,
    fileId: node.fileId,
    order: node.order,
    author: node.author,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function basename(nodePath: string): string {
  const slash = nodePath.lastIndexOf('/');
  return slash === -1 ? nodePath : nodePath.slice(slash + 1);
}

/**
 * Factory for the skill-tree Express handlers served at
 * `/api/skills/:id/tree`. The tree is a derived, path-addressed view over the
 * skill body plus its `SkillFile` rows (see `SkillTreeNode` in data-schemas):
 * node ids are skill-relative paths, folders are implicit ancestors, and the
 * sibling `order` is server-derived. Writes therefore rewrite `relativePath`
 * values rather than touching a node collection that does not exist.
 */
export function createSkillTreeHandlers(deps: SkillTreeHandlersDeps): SkillTreeHandlers {
  const {
    getSkillById,
    getSkillFileByPath,
    updateSkillFileContent,
    getStrategyFunctions,
    isValidObjectIdString,
    listSkillTree,
    renameSkillNode,
    deleteSkillNode,
    saveSkillFileContent,
  } = deps;

  function resolvedSkill(req: TreeRequest): ResolvedSkill | undefined {
    return req.resourceAccess?.resourceInfo;
  }

  async function getSkillId(req: TreeRequest): Promise<string | null> {
    const { id } = req.params as { id: string };
    if (!isValidObjectIdString(id)) {
      return null;
    }
    return id;
  }

  /** Resolve the splat `nodePath` param to a validated skill-relative path. */
  function nodePathFromParam(req: TreeRequest): string | null {
    return resolveSkillFilePathParam(
      (req.params as { nodePath?: string | string[] }).nodePath,
    );
  }

  function cleanupBlobs(
    req: TreeRequest,
    files: DeleteSkillNodeResult['files'],
  ): void {
    for (const file of files) {
      const { deleteFile: deleteBlob } = getStrategyFunctions(file.source);
      if (deleteBlob) {
        deleteBlob(req, {
          filepath: file.filepath,
          storageKey: file.storageKey,
          storageRegion: file.storageRegion,
          user: file.author,
          tenantId: file.tenantId,
        }).catch((error) =>
          logger.error(`[skill-tree] Blob cleanup failed for ${file.relativePath}:`, error),
        );
      }
    }
  }

  async function getTree(req: TreeRequest, res: Response) {
    try {
      const skillId = await getSkillId(req);
      if (skillId == null) {
        // External (registry/deployment) ids are not local ObjectIds and have no
        // persisted file tree — an empty tree, like `GET /:id/files`.
        return res.status(200).json({ nodes: [] } satisfies TSkillTreeResponse);
      }
      const nodes = await listSkillTree(skillId);
      const response: TSkillTreeResponse = { nodes: (nodes ?? []).map(toWireNode) };
      return res.status(200).json(response);
    } catch (error) {
      logger.error('[GET /skills/:id/tree] Error loading skill tree', error);
      return res.status(500).json({ error: 'Error loading skill tree' });
    }
  }

  async function createNode(req: TreeRequest, res: Response) {
    try {
      const skillId = await getSkillId(req);
      if (skillId == null) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const type = typeof body.type === 'string' ? body.type : undefined;
      if (type === 'folder') {
        return res.status(400).json({
          error: 'Folders are derived from file paths; create a file inside the folder instead',
        });
      }
      if (type !== 'file') {
        return res.status(400).json({ error: "type must be 'file'" });
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.includes('/') || name === '.' || name === '..') {
        return res.status(400).json({ error: 'A valid file name is required' });
      }
      if (name.toUpperCase() === BODY_SKILL_PATH.toUpperCase()) {
        return res.status(400).json({
          error: 'SKILL.md is reserved; update the skill body instead',
        });
      }

      const parentId =
        typeof body.parentId === 'string' && body.parentId.length > 0 ? body.parentId : null;
      const relativePath = parentId ? `${parentId}/${name}` : name;
      const issues = validateRelativePath(relativePath);
      if (issues.length > 0) {
        return res.status(400).json({ error: 'Validation failed', issues });
      }

      if (parentId) {
        const parentFile = await getSkillFileByPath(skillId, parentId);
        if (parentFile) {
          return res.status(400).json({ error: `"${parentId}" is a file, not a folder` });
        }
      }

      const existing = await getSkillFileByPath(skillId, relativePath);
      if (existing) {
        return res.status(409).json({ error: 'A file already exists at this path' });
      }

      const file = req.file;
      let content: string;
      let mimeType: string;
      if (file) {
        mimeType = file.mimetype ?? '';
        if (!isTextLikeMime(mimeType)) {
          return res.status(415).json({
            error: 'Binary files are not supported on this route; use POST /api/skills/:id/files',
          });
        }
        content = file.buffer.toString('utf8');
      } else if (typeof body.content === 'string') {
        content = body.content;
        mimeType = 'text/plain';
      } else {
        content = '';
        mimeType = 'text/plain';
      }

      const buffer = Buffer.from(content, 'utf8');
      if (isBinaryBuffer(buffer)) {
        return res.status(415).json({
          error: 'Binary files are not supported on this route; use POST /api/skills/:id/files',
        });
      }
      if (buffer.length > MAX_NODE_CONTENT_BYTES) {
        return res.status(413).json({
          error: 'File content is too large for the tree editor; use POST /api/skills/:id/files',
        });
      }

      if (
        blockFilteredSkillFile(req.config?.filters, res, {
          buffer,
          originalName: name,
          relativePath,
        })
      ) {
        return res;
      }

      await saveSkillFileContent({
        req,
        skillId,
        relativePath,
        content,
        mimeType: mimeType || 'text/plain',
      });

      const nodes = await listSkillTree(skillId);
      const node = nodes?.find((candidate) => candidate._id === relativePath);
      if (!node) {
        return res.status(500).json({ error: 'Error creating skill node' });
      }
      return res.status(201).json(toWireNode(node));
    } catch (error) {
      logger.error('[POST /skills/:id/tree] Error creating skill node', error);
      return res.status(500).json({ error: 'Error creating skill node' });
    }
  }

  async function updateNode(req: TreeRequest, res: Response) {
    try {
      const skillId = await getSkillId(req);
      if (skillId == null) {
        return res.status(404).json({ error: 'Skill not found' });
      }
      const nodePath = nodePathFromParam(req);
      if (nodePath == null) {
        return res.status(404).json({ error: 'Skill node not found' });
      }
      if (nodePath === BODY_SKILL_PATH) {
        return res.status(400).json({
          error: 'SKILL.md cannot be renamed or moved; edit the skill body instead',
        });
      }

      const nodes = await listSkillTree(skillId);
      if (!nodes) {
        return res.status(404).json({ error: 'Skill not found' });
      }
      const current = nodes.find((node) => node._id === nodePath);
      if (!current) {
        return res.status(404).json({ error: 'Skill node not found' });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const hasName = typeof body.name === 'string' && body.name.trim().length > 0;
      const hasParent = body.parentId === null || typeof body.parentId === 'string';
      if (!hasName && !hasParent) {
        // `order` is server-derived; an order-only update is a no-op we echo back.
        return res.status(200).json(toWireNode(current));
      }

      const name = hasName ? (body.name as string).trim() : current.name;
      if (name.includes('/') || name === '.' || name === '..') {
        return res.status(400).json({ error: 'A valid file name is required' });
      }
      if (name.toUpperCase() === BODY_SKILL_PATH.toUpperCase()) {
        return res.status(400).json({ error: 'SKILL.md is reserved' });
      }

      let parentId: string | null;
      if (hasParent) {
        parentId =
          typeof body.parentId === 'string' && body.parentId.length > 0
            ? (body.parentId as string)
            : null;
      } else {
        parentId = current.parentId;
      }

      if (parentId != null) {
        if (parentId === current._id || parentId.startsWith(`${current._id}/`)) {
          return res.status(400).json({ error: 'A folder cannot be moved into itself' });
        }
        const parentNode = nodes.find((node) => node._id === parentId);
        if (!parentNode) {
          return res.status(400).json({ error: `Folder "${parentId}" not found` });
        }
        if (parentNode.type !== 'folder') {
          return res.status(400).json({ error: `"${parentId}" is a file, not a folder` });
        }
      }

      const toPath = parentId ? `${parentId}/${name}` : name;
      const issues = validateRelativePath(toPath);
      if (issues.length > 0) {
        return res.status(400).json({ error: 'Validation failed', issues });
      }
      if (toPath === current._id) {
        return res.status(200).json(toWireNode(current));
      }

      if (
        blockFilteredSkillFile(req.config?.filters, res, {
          buffer: Buffer.alloc(0),
          originalName: name,
          relativePath: toPath,
        })
      ) {
        return res;
      }

      const result = await renameSkillNode({
        skillId,
        fromPath: current._id,
        toPath,
      });
      if (result.status === 'conflict') {
        return res.status(409).json({ error: 'A file already exists at this path' });
      }
      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'Skill node not found' });
      }

      const after = await listSkillTree(skillId);
      const node = after?.find((candidate) => candidate._id === toPath);
      if (!node) {
        return res.status(500).json({ error: 'Error updating skill node' });
      }
      return res.status(200).json(toWireNode(node));
    } catch (error) {
      logger.error('[PATCH /skills/:id/tree/*nodePath] Error updating skill node', error);
      return res.status(500).json({ error: 'Error updating skill node' });
    }
  }

  async function deleteNode(req: TreeRequest, res: Response) {
    try {
      const skillId = await getSkillId(req);
      if (skillId == null) {
        return res.status(404).json({ error: 'Skill not found' });
      }
      const nodePath = nodePathFromParam(req);
      if (nodePath == null) {
        return res.status(404).json({ error: 'Skill node not found' });
      }
      if (nodePath === BODY_SKILL_PATH) {
        return res.status(400).json({ error: 'SKILL.md cannot be deleted; delete the skill instead' });
      }

      const result = await deleteSkillNode({ skillId, path: nodePath });
      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'Skill node not found' });
      }

      cleanupBlobs(req, result.files);
      return res.status(200).json({
        skillId,
        nodeId: nodePath,
        deleted: true,
        removed: result.deleted,
      });
    } catch (error) {
      logger.error('[DELETE /skills/:id/tree/*nodePath] Error deleting skill node', error);
      return res.status(500).json({ error: 'Error deleting skill node' });
    }
  }

  async function getNodeContent(req: TreeRequest, res: Response) {
    try {
      const skillId = await getSkillId(req);
      if (skillId == null) {
        return res.status(404).json({ error: 'Skill not found' });
      }
      const nodePath = nodePathFromParam(req);
      if (nodePath == null) {
        return res.status(404).json({ error: 'Skill node not found' });
      }

      if (nodePath === BODY_SKILL_PATH) {
        const skill = resolvedSkill(req) ?? (await getSkillById(skillId));
        if (!skill) {
          return res.status(404).json({ error: 'Skill not found' });
        }
        return res.status(200).json({ content: skill.body, mimeType: 'text/markdown' });
      }

      const file = await getSkillFileByPath(skillId, nodePath);
      if (!file) {
        return res.status(404).json({ error: 'Skill node not found' });
      }
      if (file.isBinary === true) {
        return res.status(415).json({
          error: 'Binary skill files are not readable as text; use the files download endpoint',
        });
      }
      if (file.content != null) {
        return res.status(200).json({ content: file.content, mimeType: file.mimeType });
      }

      const strategy = getStrategyFunctions(file.source);
      if (!strategy.getDownloadStream) {
        return res.status(501).json({ error: 'Download not supported for this storage backend' });
      }

      const stream = await strategy.getDownloadStream(req, resolveDownloadPath(file));
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let binaryChecked = false;

      for await (const raw of stream) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        chunks.push(chunk);
        totalBytes += chunk.length;

        if (!binaryChecked && totalBytes >= 8192) {
          binaryChecked = true;
          if (isBinaryBuffer(Buffer.concat(chunks))) {
            updateSkillFileContent(skillId, nodePath, { isBinary: true }).catch((error) =>
              logger.error('[skill-tree] Cache write failed:', error),
            );
            if ('destroy' in stream && typeof stream.destroy === 'function') {
              stream.destroy();
            }
            return res.status(415).json({
              error: 'Binary skill files are not readable as text; use the files download endpoint',
            });
          }
        }

        if (totalBytes > MAX_NODE_CONTENT_BYTES) {
          if ('destroy' in stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
          return res.status(413).json({
            error: 'File content is too large for the tree editor; use the files download endpoint',
          });
        }
      }

      const buffer = Buffer.concat(chunks);
      if (isBinaryBuffer(buffer)) {
        updateSkillFileContent(skillId, nodePath, { isBinary: true }).catch((error) =>
          logger.error('[skill-tree] Cache write failed:', error),
        );
        return res.status(415).json({
          error: 'Binary skill files are not readable as text; use the files download endpoint',
        });
      }

      const text = buffer.toString('utf-8');
      if (buffer.length <= MAX_TEXT_CACHE_BYTES) {
        updateSkillFileContent(skillId, nodePath, { content: text, isBinary: false }).catch((error) =>
          logger.error('[skill-tree] Cache write failed:', error),
        );
      }
      return res.status(200).json({ content: text, mimeType: file.mimeType });
    } catch (error) {
      logger.error('[GET /skills/:id/tree/*nodePath/content] Error', error);
      return res.status(500).json({ error: 'Error reading skill node content' });
    }
  }

  async function updateNodeContent(req: TreeRequest, res: Response) {
    try {
      const skillId = await getSkillId(req);
      if (skillId == null) {
        return res.status(404).json({ error: 'Skill not found' });
      }
      const nodePath = nodePathFromParam(req);
      if (nodePath == null) {
        return res.status(404).json({ error: 'Skill node not found' });
      }
      if (nodePath === BODY_SKILL_PATH) {
        return res.status(400).json({
          error: 'SKILL.md content is edited via PATCH /api/skills/:id',
        });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.content !== 'string') {
        return res.status(400).json({ error: 'content is required' });
      }
      const content = body.content;
      const buffer = Buffer.from(content, 'utf8');
      if (buffer.includes(0)) {
        return res.status(400).json({ error: 'Content must be text' });
      }
      if (buffer.length > MAX_NODE_CONTENT_BYTES) {
        return res.status(413).json({
          error: 'File content is too large for the tree editor; use POST /api/skills/:id/files',
        });
      }

      const file = await getSkillFileByPath(skillId, nodePath);
      if (!file) {
        return res.status(404).json({ error: 'Skill node not found' });
      }

      if (
        blockFilteredSkillFile(req.config?.filters, res, {
          buffer,
          originalName: basename(nodePath),
          relativePath: nodePath,
        })
      ) {
        return res;
      }

      await saveSkillFileContent({
        req,
        skillId,
        relativePath: nodePath,
        content,
        mimeType: file.mimeType || 'text/plain',
      });

      const nodes = await listSkillTree(skillId);
      const node = nodes?.find((candidate) => candidate._id === nodePath);
      if (!node) {
        return res.status(500).json({ error: 'Error updating skill node content' });
      }
      return res.status(200).json(toWireNode(node));
    } catch (error) {
      logger.error('[PUT /skills/:id/tree/*nodePath/content] Error', error);
      return res.status(500).json({ error: 'Error updating skill node content' });
    }
  }

  return {
    getTree,
    createNode,
    updateNode,
    deleteNode,
    getNodeContent,
    updateNodeContent,
  };
}
