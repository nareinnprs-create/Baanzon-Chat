import type { Model } from 'mongoose';
import type {
  IToolPermission,
  IToolPermissionDocument,
  GrantToolPermissionInput,
  ToolPermissionRef,
} from '~/types/toolPermission';
import { isValidObjectIdString } from '~/utils/objectId';

export interface ToolPermissionMethods {
  /** Adds or re-activates a grant; idempotent per (tool, principal). */
  grantToolPermission(input: GrantToolPermissionInput): Promise<IToolPermission>;
  getToolPermission(ref: ToolPermissionRef): Promise<IToolPermission | null>;
  /** Every grant attached to a tool. */
  listToolPermissions(toolId: string): Promise<IToolPermission[]>;
  /** Every grant attached to a principal, across tools. */
  listToolPermissionsForPrincipal(
    principalType: ToolPermissionRef['principalType'],
    principalId: string,
  ): Promise<IToolPermission[]>;
  revokeToolPermission(ref: ToolPermissionRef): Promise<boolean>;
}

export function createToolPermissionMethods(
  mongoose: typeof import('mongoose'),
): ToolPermissionMethods {
  const ToolPermission = (): Model<IToolPermissionDocument> =>
    mongoose.models.ToolPermission as Model<IToolPermissionDocument>;

  function principalFilter(ref: ToolPermissionRef): {
    toolId: string;
    principalType: ToolPermissionRef['principalType'];
    principalId: string;
  } {
    return {
      toolId: ref.toolId,
      principalType: ref.principalType,
      principalId: ref.principalId,
    };
  }

  async function grantToolPermission(input: GrantToolPermissionInput): Promise<IToolPermission> {
    if (!isValidObjectIdString(input.toolId)) {
      throw new Error('A valid toolId is required');
    }
    if (!isValidObjectIdString(input.createdBy)) {
      throw new Error('A valid createdBy is required');
    }
    const principalId = input.principalId?.trim();
    if (!principalId) {
      throw new Error('A principalId is required');
    }

    const grant = await ToolPermission()
      .findOneAndUpdate(
        { toolId: input.toolId, principalType: input.principalType, principalId },
        {
          $set: { granted: input.granted ?? true, createdBy: input.createdBy },
          $setOnInsert: { toolId: input.toolId, principalType: input.principalType, principalId },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean<IToolPermission>();
    if (!grant) {
      throw new Error('Failed to grant tool permission');
    }
    return grant;
  }

  async function getToolPermission(ref: ToolPermissionRef): Promise<IToolPermission | null> {
    if (!isValidObjectIdString(ref.toolId)) {
      return null;
    }
    return await ToolPermission().findOne(principalFilter(ref)).lean<IToolPermission>();
  }

  async function listToolPermissions(toolId: string): Promise<IToolPermission[]> {
    if (!isValidObjectIdString(toolId)) {
      return [];
    }
    return await ToolPermission()
      .find({ toolId })
      .sort({ principalType: 1, principalId: 1, _id: 1 })
      .lean<IToolPermission[]>();
  }

  async function listToolPermissionsForPrincipal(
    principalType: ToolPermissionRef['principalType'],
    principalId: string,
  ): Promise<IToolPermission[]> {
    if (!principalId?.trim()) {
      return [];
    }
    return await ToolPermission()
      .find({ principalType, principalId })
      .sort({ toolId: 1, _id: 1 })
      .lean<IToolPermission[]>();
  }

  async function revokeToolPermission(ref: ToolPermissionRef): Promise<boolean> {
    if (!isValidObjectIdString(ref.toolId)) {
      return false;
    }
    const result = await ToolPermission().deleteOne(principalFilter(ref));
    return result.deletedCount === 1;
  }

  return {
    grantToolPermission,
    getToolPermission,
    listToolPermissions,
    listToolPermissionsForPrincipal,
    revokeToolPermission,
  };
}
