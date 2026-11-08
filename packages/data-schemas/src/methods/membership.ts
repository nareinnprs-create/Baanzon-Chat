import type { Model } from 'mongoose';
import type {
  IMembership,
  IMembershipDocument,
  MembershipRole,
  MembershipStatus,
  AddMembershipInput,
  UpdateMembershipInput,
} from '~/types/membership';
import { isValidObjectIdString } from '~/utils/objectId';

export interface MembershipMethods {
  /** Adds or re-activates a membership; idempotent per (org, user). */
  addMembership(input: AddMembershipInput): Promise<IMembership>;
  getMembership(organizationId: string, userId: string): Promise<IMembership | null>;
  listOrganizationMemberships(organizationId: string): Promise<IMembership[]>;
  listUserMemberships(userId: string): Promise<IMembership[]>;
  updateMembership(
    organizationId: string,
    userId: string,
    patch: UpdateMembershipInput,
  ): Promise<IMembership | null>;
  removeMembership(organizationId: string, userId: string): Promise<boolean>;
}

export function createMembershipMethods(mongoose: typeof import('mongoose')): MembershipMethods {
  const Membership = (): Model<IMembershipDocument> =>
    mongoose.models.Membership as Model<IMembershipDocument>;

  async function addMembership(input: AddMembershipInput): Promise<IMembership> {
    if (!isValidObjectIdString(input.organizationId)) {
      throw new Error('A valid organizationId is required');
    }
    if (!isValidObjectIdString(input.userId)) {
      throw new Error('A valid userId is required');
    }

    const set: { role: MembershipRole; status: MembershipStatus; invitedBy?: string } = {
      role: input.role ?? 'member',
      status: input.status ?? 'active',
    };
    if (input.invitedBy !== undefined) {
      set.invitedBy = input.invitedBy;
    }

    const membership = await Membership()
      .findOneAndUpdate(
        { organizationId: input.organizationId, userId: input.userId },
        { $set: set },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean<IMembership>();
    if (!membership) {
      throw new Error('Failed to add membership');
    }
    return membership;
  }

  async function getMembership(
    organizationId: string,
    userId: string,
  ): Promise<IMembership | null> {
    if (!isValidObjectIdString(organizationId) || !isValidObjectIdString(userId)) {
      return null;
    }
    return await Membership().findOne({ organizationId, userId }).lean<IMembership>();
  }

  async function listOrganizationMemberships(organizationId: string): Promise<IMembership[]> {
    if (!isValidObjectIdString(organizationId)) {
      return [];
    }
    return await Membership()
      .find({ organizationId })
      .sort({ createdAt: 1, _id: 1 })
      .lean<IMembership[]>();
  }

  async function listUserMemberships(userId: string): Promise<IMembership[]> {
    if (!isValidObjectIdString(userId)) {
      return [];
    }
    return await Membership()
      .find({ userId, status: 'active' })
      .sort({ createdAt: -1, _id: -1 })
      .lean<IMembership[]>();
  }

  async function updateMembership(
    organizationId: string,
    userId: string,
    patch: UpdateMembershipInput,
  ): Promise<IMembership | null> {
    if (!isValidObjectIdString(organizationId) || !isValidObjectIdString(userId)) {
      return null;
    }

    const update: Partial<Pick<IMembership, 'role' | 'status'>> = {};
    if (patch.role !== undefined) {
      update.role = patch.role;
    }
    if (patch.status !== undefined) {
      update.status = patch.status;
    }

    return await Membership()
      .findOneAndUpdate(
        { organizationId, userId },
        { $set: update },
        { new: true, runValidators: true },
      )
      .lean<IMembership>();
  }

  async function removeMembership(organizationId: string, userId: string): Promise<boolean> {
    if (!isValidObjectIdString(organizationId) || !isValidObjectIdString(userId)) {
      return false;
    }
    const result = await Membership().deleteOne({ organizationId, userId });
    return result.deletedCount === 1;
  }

  return {
    addMembership,
    getMembership,
    listOrganizationMemberships,
    listUserMemberships,
    updateMembership,
    removeMembership,
  };
}
