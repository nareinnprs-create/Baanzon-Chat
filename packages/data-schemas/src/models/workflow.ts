import { Model } from 'mongoose';
import type { IWorkflowDocument } from '~/types/workflow';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import workflowSchema from '~/schema/workflow';

export function createWorkflowModel(mongoose: typeof import('mongoose')): Model<IWorkflowDocument> {
  applyTenantIsolation(workflowSchema);
  return (
    mongoose.models.Workflow ||
    mongoose.model<IWorkflowDocument>('Workflow', workflowSchema, 'workflows')
  );
}
