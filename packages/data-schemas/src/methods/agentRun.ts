import type { Model } from 'mongoose';
import type {
  IAgentRun,
  IAgentRunDocument,
  AgentRunStatus,
  StartAgentRunInput,
  CompleteAgentRunInput,
  ListAgentRunsOptions,
} from '~/types/agentRun';

/** Default page size for run listings. */
export const AGENT_RUN_LIST_DEFAULT_LIMIT = 50;
/** Hard cap on a run listing page. */
export const AGENT_RUN_LIST_MAX_LIMIT = 200;

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return AGENT_RUN_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), AGENT_RUN_LIST_MAX_LIMIT);
}

export interface AgentRunMethods {
  /** Creates the run, or returns the existing one for a repeated `runId`. */
  startAgentRun(input: StartAgentRunInput): Promise<IAgentRun>;
  getAgentRun(userId: string, runId: string): Promise<IAgentRun | null>;
  markAgentRunRunning(userId: string, runId: string): Promise<IAgentRun | null>;
  /** Settles a run into a terminal state and records its token totals. */
  completeAgentRun(
    userId: string,
    runId: string,
    input: CompleteAgentRunInput,
  ): Promise<IAgentRun | null>;
  listAgentRunsForUser(userId: string, options?: ListAgentRunsOptions): Promise<IAgentRun[]>;
  listAgentRunsForAgent(agentId: string, options?: ListAgentRunsOptions): Promise<IAgentRun[]>;
}

export function createAgentRunMethods(mongoose: typeof import('mongoose')): AgentRunMethods {
  const AgentRun = (): Model<IAgentRunDocument> =>
    mongoose.models.AgentRun as Model<IAgentRunDocument>;

  async function startAgentRun(input: StartAgentRunInput): Promise<IAgentRun> {
    const run = await AgentRun()
      .findOneAndUpdate(
        { runId: input.runId, user: input.user },
        {
          $setOnInsert: {
            runId: input.runId,
            agentId: input.agentId,
            user: input.user,
            conversationId: input.conversationId,
            messageId: input.messageId,
            status: 'pending',
            metadata: input.metadata,
            startedAt: new Date(),
          },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean<IAgentRun>();
    if (!run) {
      throw new Error('Failed to start agent run');
    }
    return run;
  }

  async function getAgentRun(userId: string, runId: string): Promise<IAgentRun | null> {
    return await AgentRun().findOne({ runId, user: userId }).lean<IAgentRun>();
  }

  async function markAgentRunRunning(userId: string, runId: string): Promise<IAgentRun | null> {
    return await AgentRun()
      .findOneAndUpdate(
        { runId, user: userId, status: { $in: ['pending', 'running'] } },
        { $set: { status: 'running' } },
        { new: true },
      )
      .lean<IAgentRun>();
  }

  async function completeAgentRun(
    userId: string,
    runId: string,
    input: CompleteAgentRunInput,
  ): Promise<IAgentRun | null> {
    const update: Partial<
      Pick<IAgentRun, 'status' | 'error' | 'inputTokens' | 'outputTokens' | 'finishedAt'>
    > = {
      status: input.status,
      finishedAt: new Date(),
    };
    if (input.error !== undefined) {
      update.error = input.error;
    }
    if (input.inputTokens !== undefined) {
      update.inputTokens = input.inputTokens;
    }
    if (input.outputTokens !== undefined) {
      update.outputTokens = input.outputTokens;
    }

    return await AgentRun()
      .findOneAndUpdate(
        { runId, user: userId },
        { $set: update },
        { new: true, runValidators: true },
      )
      .lean<IAgentRun>();
  }

  async function listAgentRunsForUser(
    userId: string,
    options?: ListAgentRunsOptions,
  ): Promise<IAgentRun[]> {
    const filter: { user: string; status?: AgentRunStatus } = { user: userId };
    if (options?.status !== undefined) {
      filter.status = options.status;
    }
    return await AgentRun()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<IAgentRun[]>();
  }

  async function listAgentRunsForAgent(
    agentId: string,
    options?: ListAgentRunsOptions,
  ): Promise<IAgentRun[]> {
    const filter: { agentId: string; status?: AgentRunStatus } = { agentId };
    if (options?.status !== undefined) {
      filter.status = options.status;
    }
    return await AgentRun()
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizeLimit(options?.limit))
      .lean<IAgentRun[]>();
  }

  return {
    startAgentRun,
    getAgentRun,
    markAgentRunRunning,
    completeAgentRun,
    listAgentRunsForUser,
    listAgentRunsForAgent,
  };
}
