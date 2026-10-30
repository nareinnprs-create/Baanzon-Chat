import { Model } from 'mongoose';
import type { IAgentRunDocument } from '~/types/agentRun';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agentRunSchema from '~/schema/agentRun';

export function createAgentRunModel(mongoose: typeof import('mongoose')): Model<IAgentRunDocument> {
  applyTenantIsolation(agentRunSchema);
  return (
    mongoose.models.AgentRun ||
    mongoose.model<IAgentRunDocument>('AgentRun', agentRunSchema, 'agent_runs')
  );
}
