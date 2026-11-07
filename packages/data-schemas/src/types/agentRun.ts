import type { Document, Types } from 'mongoose';

/** Lifecycle of a single agent execution. */
export type AgentRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * A single execution of an agent (blueprint §45 `agent_runs`).
 *
 * One row per run, updated in place from `pending` through a terminal state.
 * Runs are owner-scoped and tenant-scoped; the token totals are copied from the
 * provider response at settlement so a run can be audited without replaying the
 * conversation.
 */
export interface IAgentRun {
  _id?: Types.ObjectId;
  /** Caller-supplied run id, unique within the tenant. */
  runId: string;
  agentId: string;
  user: Types.ObjectId;
  conversationId?: string;
  messageId?: string;
  status: AgentRunStatus;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  startedAt?: Date;
  finishedAt?: Date;
  /** Run metadata; opaque to this package. */
  metadata?: Record<string, unknown>;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IAgentRunDocument extends Omit<IAgentRun, '_id'>, Document {}

export interface StartAgentRunInput {
  runId: string;
  agentId: string;
  user: string;
  conversationId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

export interface CompleteAgentRunInput {
  status: Extract<AgentRunStatus, 'succeeded' | 'failed' | 'cancelled'>;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface ListAgentRunsOptions {
  status?: AgentRunStatus;
  limit?: number;
}
