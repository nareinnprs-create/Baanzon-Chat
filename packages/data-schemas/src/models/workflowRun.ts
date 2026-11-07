import { Model } from 'mongoose';
import type { IWorkflowRunDocument } from '~/types/workflowRun';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import workflowRunSchema from '~/schema/workflowRun';

export function createWorkflowRunModel(
  mongoose: typeof import('mongoose'),
): Model<IWorkflowRunDocument> {
  applyTenantIsolation(workflowRunSchema);
  return (
    mongoose.models.WorkflowRun ||
    mongoose.model<IWorkflowRunDocument>('WorkflowRun', workflowRunSchema, 'workflow_runs')
  );
}
