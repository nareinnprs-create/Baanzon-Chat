import type { Model } from 'mongoose';
import type {
  IOrganization,
  IOrganizationDocument,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '~/types/organization';
import type { IMembership } from '~/types/membership';
import { isValidObjectIdString } from '~/utils/objectId';

/** Longest slug accepted, matching the schema's `maxlength`. */
export const ORGANIZATION_SLUG_MAX_LENGTH = 200;

/** Lowercases and dashes a human name into a URL-safe slug. */
export function slugifyOrganizationName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, ORGANIZATION_SLUG_MAX_LENGTH);
}

export interface OrganizationMethods {
  createOrganization(input: CreateOrganizationInput): Promise<IOrganization>;
  getOrganization(organizationId: string): Promise<IOrganization | null>;
  /** Organizations the user owns or is an active member of, newest first. */
  listOrganizationsForUser(userId: string): Promise<IOrganization[]>;
  updateOrganization(
    organizationId: string,
    patch: UpdateOrganizationInput,
  ): Promise<IOrganization | null>;
  /** Removes the org and cascades to its memberships and workspaces. */
  deleteOrganization(organizationId: string): Promise<boolean>;
}

export function createOrganizationMethods(
  mongoose: typeof import('mongoose'),
): OrganizationMethods {
  const Organization = (): Model<IOrganizationDocument> =>
    mongoose.models.Organization as Model<IOrganizationDocument>;
  const Membership = (): Model<IMembership> => mongoose.models.Membership as Model<IMembership>;

  async function createOrganization(input: CreateOrganizationInput): Promise<IOrganization> {
    const name = input.name?.trim();
    if (!name) {
      throw new Error('Organization name is required');
    }

    const isPersonal = input.isPersonal ?? false;
    let slug: string;
    if (input.slug?.trim()) {
      slug = slugifyOrganizationName(input.slug);
    } else if (isPersonal) {
      slug = `personal-${input.owner}`;
    } else {
      slug = slugifyOrganizationName(name) || 'org';
    }

    const created = await Organization().create({
      name,
      slug,
      owner: input.owner,
      status: 'active',
      isPersonal,
      settings: input.settings,
    });
    return created.toObject() as IOrganization;
  }

  async function getOrganization(organizationId: string): Promise<IOrganization | null> {
    if (!isValidObjectIdString(organizationId)) {
      return null;
    }
    return await Organization().findById(organizationId).lean<IOrganization>();
  }

  async function listOrganizationsForUser(userId: string): Promise<IOrganization[]> {
    const memberships = await Membership()
      .find({ userId, status: 'active' })
      .select('organizationId')
      .lean<Pick<IMembership, 'organizationId'>[]>();
    const memberOrgIds = memberships.map((membership) => membership.organizationId);

    return await Organization()
      .find({ $or: [{ owner: userId }, { _id: { $in: memberOrgIds } }] })
      .sort({ createdAt: -1, _id: -1 })
      .lean<IOrganization[]>();
  }

  async function updateOrganization(
    organizationId: string,
    patch: UpdateOrganizationInput,
  ): Promise<IOrganization | null> {
    if (!isValidObjectIdString(organizationId)) {
      return null;
    }

    const update: Partial<Pick<IOrganization, 'name' | 'status' | 'settings'>> = {};
    if (typeof patch.name === 'string') {
      const name = patch.name.trim();
      if (!name) {
        throw new Error('Organization name is required');
      }
      update.name = name;
    }
    if (patch.status !== undefined) {
      update.status = patch.status;
    }
    if (patch.settings !== undefined) {
      update.settings = patch.settings;
    }

    return await Organization()
      .findByIdAndUpdate(organizationId, { $set: update }, { new: true, runValidators: true })
      .lean<IOrganization>();
  }

  async function deleteOrganization(organizationId: string): Promise<boolean> {
    if (!isValidObjectIdString(organizationId)) {
      return false;
    }

    const deleted = await Organization().findOneAndDelete({ _id: organizationId });
    if (!deleted) {
      return false;
    }

    await Membership().deleteMany({ organizationId });
    if (mongoose.models.Workspace) {
      await mongoose.models.Workspace.deleteMany({ organizationId });
    }
    return true;
  }

  return {
    createOrganization,
    getOrganization,
    listOrganizationsForUser,
    updateOrganization,
    deleteOrganization,
  };
}
