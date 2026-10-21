import type { Document, Types } from 'mongoose';

export interface IChatProject {
  _id?: Types.ObjectId;
  name: string;
  description?: string;
  user: string;
  /**
   * Owning workspace as its ObjectId hex string, mirroring how
   * `workspace.organizationId` is passed between the storage and API layers.
   * Optional: pre-workspace projects and personal projects carry none.
   */
  workspaceId?: string;
  conversationCount: number;
  lastConversationAt?: Date | null;
  lastConversationId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}

export interface IChatProjectDocument extends Omit<IChatProject, '_id'>, Document {}
