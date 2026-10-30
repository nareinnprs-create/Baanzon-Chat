import { Model } from 'mongoose';
import type { IToolPermissionDocument } from '~/types/toolPermission';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import toolPermissionSchema from '~/schema/toolPermission';

export function createToolPermissionModel(
  mongoose: typeof import('mongoose'),
): Model<IToolPermissionDocument> {
  applyTenantIsolation(toolPermissionSchema);
  return (
    mongoose.models.ToolPermission ||
    mongoose.model<IToolPermissionDocument>(
      'ToolPermission',
      toolPermissionSchema,
      'tool_permissions',
    )
  );
}
