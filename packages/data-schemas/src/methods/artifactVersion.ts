import type { Model } from 'mongoose';
import type {
  IArtifactVersion,
  IArtifactVersionDocument,
  CreateArtifactVersionInput,
  ListArtifactVersionsOptions,
} from '~/types/artifactVersion';
import { isValidObjectIdString } from '~/utils/objectId';

/** Hard cap on how many revisions one listing returns. */
export const ARTIFACT_VERSION_LIST_MAX_LIMIT = 100;

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return ARTIFACT_VERSION_LIST_MAX_LIMIT;
  }
  return Math.min(Math.floor(limit), ARTIFACT_VERSION_LIST_MAX_LIMIT);
}

export interface ArtifactVersionMethods {
  /** Appends the next revision and advances the artifact's `currentVersion`. */
  createArtifactVersion(input: CreateArtifactVersionInput): Promise<IArtifactVersion>;
  getArtifactVersion(artifactId: string, version: number): Promise<IArtifactVersion | null>;
  getLatestArtifactVersion(artifactId: string): Promise<IArtifactVersion | null>;
  /** Newest revision first. */
  listArtifactVersions(
    artifactId: string,
    options?: ListArtifactVersionsOptions,
  ): Promise<IArtifactVersion[]>;
  /** Removes every revision of an artifact; returns how many were dropped. */
  deleteArtifactVersionsForArtifact(artifactId: string): Promise<number>;
}

export function createArtifactVersionMethods(
  mongoose: typeof import('mongoose'),
): ArtifactVersionMethods {
  const ArtifactVersion = (): Model<IArtifactVersionDocument> =>
    mongoose.models.ArtifactVersion as Model<IArtifactVersionDocument>;

  async function createArtifactVersion(
    input: CreateArtifactVersionInput,
  ): Promise<IArtifactVersion> {
    if (!isValidObjectIdString(input.artifactId)) {
      throw new Error('A valid artifactId is required');
    }
    if (!isValidObjectIdString(input.createdBy)) {
      throw new Error('A valid createdBy is required');
    }

    const latest = await ArtifactVersion()
      .findOne({ artifactId: input.artifactId })
      .sort({ version: -1 })
      .select('version')
      .lean<Pick<IArtifactVersion, 'version'>>();
    const version = (latest?.version ?? 0) + 1;

    const created = await ArtifactVersion().create({
      artifactId: input.artifactId,
      version,
      content: input.content,
      language: input.language,
      createdBy: input.createdBy,
    });

    if (mongoose.models.Artifact) {
      await mongoose.models.Artifact.updateOne(
        { _id: input.artifactId },
        { $set: { currentVersion: version } },
      );
    }

    return created.toObject() as IArtifactVersion;
  }

  async function getArtifactVersion(
    artifactId: string,
    version: number,
  ): Promise<IArtifactVersion | null> {
    if (!isValidObjectIdString(artifactId) || !Number.isInteger(version)) {
      return null;
    }
    return await ArtifactVersion().findOne({ artifactId, version }).lean<IArtifactVersion>();
  }

  async function getLatestArtifactVersion(artifactId: string): Promise<IArtifactVersion | null> {
    if (!isValidObjectIdString(artifactId)) {
      return null;
    }
    return await ArtifactVersion()
      .findOne({ artifactId })
      .sort({ version: -1 })
      .lean<IArtifactVersion>();
  }

  async function listArtifactVersions(
    artifactId: string,
    options?: ListArtifactVersionsOptions,
  ): Promise<IArtifactVersion[]> {
    if (!isValidObjectIdString(artifactId)) {
      return [];
    }
    return await ArtifactVersion()
      .find({ artifactId })
      .sort({ version: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<IArtifactVersion[]>();
  }

  async function deleteArtifactVersionsForArtifact(artifactId: string): Promise<number> {
    if (!isValidObjectIdString(artifactId)) {
      return 0;
    }
    const result = await ArtifactVersion().deleteMany({ artifactId });
    return result.deletedCount ?? 0;
  }

  return {
    createArtifactVersion,
    getArtifactVersion,
    getLatestArtifactVersion,
    listArtifactVersions,
    deleteArtifactVersionsForArtifact,
  };
}
