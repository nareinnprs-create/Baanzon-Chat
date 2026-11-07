import type { Model } from 'mongoose';
import type {
  IArtifact,
  IArtifactDocument,
  CreateArtifactInput,
  UpdateArtifactInput,
} from '~/types/artifact';
import { isValidObjectIdString } from '~/utils/objectId';

/** Default page size for an artifact library. */
export const ARTIFACT_LIST_DEFAULT_LIMIT = 50;
/** Hard cap on an artifact library page. */
export const ARTIFACT_LIST_MAX_LIMIT = 200;

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return ARTIFACT_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), ARTIFACT_LIST_MAX_LIMIT);
}

export interface ArtifactMethods {
  createArtifact(input: CreateArtifactInput): Promise<IArtifact>;
  getArtifact(userId: string, artifactId: string): Promise<IArtifact | null>;
  /** A user's artifacts, newest first. */
  listArtifactsForUser(userId: string, options?: { limit?: number }): Promise<IArtifact[]>;
  listArtifactsForConversation(userId: string, conversationId: string): Promise<IArtifact[]>;
  updateArtifact(
    userId: string,
    artifactId: string,
    patch: UpdateArtifactInput,
  ): Promise<IArtifact | null>;
  /** Removes the artifact and cascades to its versions. */
  deleteArtifact(userId: string, artifactId: string): Promise<boolean>;
}

export function createArtifactMethods(mongoose: typeof import('mongoose')): ArtifactMethods {
  const Artifact = (): Model<IArtifactDocument> =>
    mongoose.models.Artifact as Model<IArtifactDocument>;

  async function createArtifact(input: CreateArtifactInput): Promise<IArtifact> {
    if (!isValidObjectIdString(input.user)) {
      throw new Error('A valid user is required');
    }
    const title = input.title?.trim();
    if (!title) {
      throw new Error('Artifact title is required');
    }

    const created = await Artifact().create({
      title,
      type: input.type,
      user: input.user,
      conversationId: input.conversationId,
      currentVersion: 0,
      metadata: input.metadata,
    });
    return created.toObject() as IArtifact;
  }

  async function getArtifact(userId: string, artifactId: string): Promise<IArtifact | null> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(artifactId)) {
      return null;
    }
    return await Artifact().findOne({ _id: artifactId, user: userId }).lean<IArtifact>();
  }

  async function listArtifactsForUser(
    userId: string,
    options?: { limit?: number },
  ): Promise<IArtifact[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    return await Artifact()
      .find({ user: userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<IArtifact[]>();
  }

  async function listArtifactsForConversation(
    userId: string,
    conversationId: string,
  ): Promise<IArtifact[]> {
    if (!isValidObjectIdString(userId) || !conversationId) {
      return [];
    }
    return await Artifact()
      .find({ user: userId, conversationId })
      .sort({ createdAt: 1, _id: 1 })
      .lean<IArtifact[]>();
  }

  async function updateArtifact(
    userId: string,
    artifactId: string,
    patch: UpdateArtifactInput,
  ): Promise<IArtifact | null> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(artifactId)) {
      return null;
    }

    const update: Partial<Pick<IArtifact, 'title' | 'metadata'>> = {};
    if (typeof patch.title === 'string') {
      const title = patch.title.trim();
      if (!title) {
        throw new Error('Artifact title is required');
      }
      update.title = title;
    }
    if (patch.metadata !== undefined) {
      update.metadata = patch.metadata;
    }

    return await Artifact()
      .findOneAndUpdate(
        { _id: artifactId, user: userId },
        { $set: update },
        { new: true, runValidators: true },
      )
      .lean<IArtifact>();
  }

  async function deleteArtifact(userId: string, artifactId: string): Promise<boolean> {
    if (!isValidObjectIdString(userId) || !isValidObjectIdString(artifactId)) {
      return false;
    }

    const deleted = await Artifact().findOneAndDelete({ _id: artifactId, user: userId });
    if (!deleted) {
      return false;
    }

    if (mongoose.models.ArtifactVersion) {
      await mongoose.models.ArtifactVersion.deleteMany({ artifactId });
    }
    return true;
  }

  return {
    createArtifact,
    getArtifact,
    listArtifactsForUser,
    listArtifactsForConversation,
    updateArtifact,
    deleteArtifact,
  };
}
