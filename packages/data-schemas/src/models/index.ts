import { createAgentQueuedTurnModel, createAgentQueuedTurnSequenceModel } from './queuedTurn';
import { createAgentTriggerLaneSequenceModel } from './triggerLaneSequence';
import { createScheduleModel, createScheduleRunModel } from './schedule';
import { createSkillSyncCredentialModel } from './skillSyncCredential';
import { createOpenIDRefreshFlightModel } from './openidRefreshFlight';
import { createKnowledgeCollectionModel } from './knowledgeCollection';
import { createAgentTriggerUserPurgeModel } from './triggerUserPurge';
import { createRefreshTokenBridgeModel } from './refreshTokenBridge';
import { createAgentTriggerDeliveryModel } from './triggerDelivery';
import { createArtifactVersionModel } from './artifactVersion';
import { createSkillSyncStatusModel } from './skillSyncStatus';
import { createConversationTagModel } from './conversationTag';
import { createCodeEnvironmentModel } from './codeEnvironment';
import { createToolPermissionModel } from './toolPermission';
import { createAgentCategoryModel } from './agentCategory';
import { createOrganizationModel } from './organization';
import { createNotificationModel } from './notification';
import { createSubscriptionModel } from './subscription';
import { createToolVersionModel } from './toolVersion';
import { createWorkflowRunModel } from './workflowRun';
import { createUsageRecordModel } from './usageRecord';
import { createChatProjectModel } from './chatProject';
import { createAgentApiKeyModel } from './agentApiKey';
import { createTransactionModel } from './transaction';
import { createPromptGroupModel } from './promptGroup';
import { createSystemGrantModel } from './systemGrant';
import { createMessagePartModel } from './messagePart';
import { createPluginAuthModel } from './pluginAuth';
import { createSharedLinkModel } from './sharedLink';
import { createAccessRoleModel } from './accessRole';
import { createToolFavoriteModel } from './favorite';
import { createMembershipModel } from './membership';
import { createMCPServerModel } from './mcpServer';
import { createAssistantModel } from './assistant';
import { createSkillFileModel } from './skillFile';
import { createWorkspaceModel } from './workspace';
import { createConversationModel } from './convo';
import { createFeedbackModel } from './feedback';
import { createWorkflowModel } from './workflow';
import { createArtifactModel } from './artifact';
import { createCitationModel } from './citation';
import { createToolCallModel } from './toolCall';
import { createAclEntryModel } from './aclEntry';
import { createAuditLogModel } from './auditLog';
import { createAgentRunModel } from './agentRun';
import { createSessionModel } from './session';
import { createBalanceModel } from './balance';
import { createMessageModel } from './message';
import { createDeviceModel } from './device';
import { createSourceModel } from './source';
import { createActionModel } from './action';
import { createBannerModel } from './banner';
import { createPresetModel } from './preset';
import { createPromptModel } from './prompt';
import { createMemoryModel } from './memory';
import { createConfigModel } from './config';
import { createTokenModel } from './token';
import { createAgentModel } from './agent';
import { createSkillModel } from './skill';
import { createGroupModel } from './group';
import { createToolModel } from './tool';
import { createUserModel } from './user';
import { createRoleModel } from './role';
import { createFileModel } from './file';
import { createKeyModel } from './key';
import logger from '~/config/winston';

/**
 * Creates all database models for all collections
 */
export function createModels(mongoose: typeof import('mongoose')): {
  User: ReturnType<typeof createUserModel>;
  Token: ReturnType<typeof createTokenModel>;
  Session: ReturnType<typeof createSessionModel>;
  Balance: ReturnType<typeof createBalanceModel>;
  Conversation: ReturnType<typeof createConversationModel>;
  ChatProject: ReturnType<typeof createChatProjectModel>;
  CodeEnvironment: ReturnType<typeof createCodeEnvironmentModel>;
  Message: ReturnType<typeof createMessageModel>;
  Agent: ReturnType<typeof createAgentModel>;
  AgentApiKey: ReturnType<typeof createAgentApiKeyModel>;
  AgentCategory: ReturnType<typeof createAgentCategoryModel>;
  MCPServer: ReturnType<typeof createMCPServerModel>;
  Role: ReturnType<typeof createRoleModel>;
  Action: ReturnType<typeof createActionModel>;
  Assistant: ReturnType<typeof createAssistantModel>;
  File: ReturnType<typeof createFileModel>;
  Banner: ReturnType<typeof createBannerModel>;
  Key: ReturnType<typeof createKeyModel>;
  PluginAuth: ReturnType<typeof createPluginAuthModel>;
  Transaction: ReturnType<typeof createTransactionModel>;
  Preset: ReturnType<typeof createPresetModel>;
  Prompt: ReturnType<typeof createPromptModel>;
  PromptGroup: ReturnType<typeof createPromptGroupModel>;
  Skill: ReturnType<typeof createSkillModel>;
  SkillFile: ReturnType<typeof createSkillFileModel>;
  SkillSyncCredential: ReturnType<typeof createSkillSyncCredentialModel>;
  SkillSyncStatus: ReturnType<typeof createSkillSyncStatusModel>;
  ConversationTag: ReturnType<typeof createConversationTagModel>;
  SharedLink: ReturnType<typeof createSharedLinkModel>;
  ToolCall: ReturnType<typeof createToolCallModel>;
  MemoryEntry: ReturnType<typeof createMemoryModel>;
  KnowledgeCollection: ReturnType<typeof createKnowledgeCollectionModel>;
  ToolFavorite: ReturnType<typeof createToolFavoriteModel>;
  AccessRole: ReturnType<typeof createAccessRoleModel>;
  AclEntry: ReturnType<typeof createAclEntryModel>;
  SystemGrant: ReturnType<typeof createSystemGrantModel>;
  AuditLog: ReturnType<typeof createAuditLogModel>;
  Group: ReturnType<typeof createGroupModel>;
  Config: ReturnType<typeof createConfigModel>;
  AgentTriggerDelivery: ReturnType<typeof createAgentTriggerDeliveryModel>;
  AgentTriggerLaneSequence: ReturnType<typeof createAgentTriggerLaneSequenceModel>;
  AgentTriggerUserPurge: ReturnType<typeof createAgentTriggerUserPurgeModel>;
  AgentQueuedTurn: ReturnType<typeof createAgentQueuedTurnModel>;
  AgentQueuedTurnSequence: ReturnType<typeof createAgentQueuedTurnSequenceModel>;
  Schedule: ReturnType<typeof createScheduleModel>;
  ScheduleRun: ReturnType<typeof createScheduleRunModel>;
  RefreshTokenBridge: ReturnType<typeof createRefreshTokenBridgeModel>;
  OpenIDRefreshFlight: ReturnType<typeof createOpenIDRefreshFlightModel>;
  Organization: ReturnType<typeof createOrganizationModel>;
  Membership: ReturnType<typeof createMembershipModel>;
  Workspace: ReturnType<typeof createWorkspaceModel>;
  MessagePart: ReturnType<typeof createMessagePartModel>;
  AgentRun: ReturnType<typeof createAgentRunModel>;
  Notification: ReturnType<typeof createNotificationModel>;
  Tool: ReturnType<typeof createToolModel>;
  ToolVersion: ReturnType<typeof createToolVersionModel>;
  ToolPermission: ReturnType<typeof createToolPermissionModel>;
  Source: ReturnType<typeof createSourceModel>;
  Citation: ReturnType<typeof createCitationModel>;
  Artifact: ReturnType<typeof createArtifactModel>;
  ArtifactVersion: ReturnType<typeof createArtifactVersionModel>;
  Workflow: ReturnType<typeof createWorkflowModel>;
  WorkflowRun: ReturnType<typeof createWorkflowRunModel>;
  Device: ReturnType<typeof createDeviceModel>;
  Subscription: ReturnType<typeof createSubscriptionModel>;
  UsageRecord: ReturnType<typeof createUsageRecordModel>;
  Feedback: ReturnType<typeof createFeedbackModel>;
} {
  const models = {
    User: createUserModel(mongoose),
    Token: createTokenModel(mongoose),
    Session: createSessionModel(mongoose),
    Balance: createBalanceModel(mongoose),
    Conversation: createConversationModel(mongoose),
    ChatProject: createChatProjectModel(mongoose),
    CodeEnvironment: createCodeEnvironmentModel(mongoose),
    Message: createMessageModel(mongoose),
    Agent: createAgentModel(mongoose),
    AgentApiKey: createAgentApiKeyModel(mongoose),
    AgentCategory: createAgentCategoryModel(mongoose),
    MCPServer: createMCPServerModel(mongoose),
    Role: createRoleModel(mongoose),
    Action: createActionModel(mongoose),
    Assistant: createAssistantModel(mongoose),
    File: createFileModel(mongoose),
    Banner: createBannerModel(mongoose),
    Key: createKeyModel(mongoose),
    PluginAuth: createPluginAuthModel(mongoose),
    Transaction: createTransactionModel(mongoose),
    Preset: createPresetModel(mongoose),
    Prompt: createPromptModel(mongoose),
    PromptGroup: createPromptGroupModel(mongoose),
    Skill: createSkillModel(mongoose),
    SkillFile: createSkillFileModel(mongoose),
    SkillSyncCredential: createSkillSyncCredentialModel(mongoose),
    SkillSyncStatus: createSkillSyncStatusModel(mongoose),
    ConversationTag: createConversationTagModel(mongoose),
    SharedLink: createSharedLinkModel(mongoose),
    ToolCall: createToolCallModel(mongoose),
    MemoryEntry: createMemoryModel(mongoose),
    KnowledgeCollection: createKnowledgeCollectionModel(mongoose),
    ToolFavorite: createToolFavoriteModel(mongoose),
    AccessRole: createAccessRoleModel(mongoose),
    AclEntry: createAclEntryModel(mongoose),
    SystemGrant: createSystemGrantModel(mongoose),
    AuditLog: createAuditLogModel(mongoose),
    Group: createGroupModel(mongoose),
    Config: createConfigModel(mongoose),
    AgentTriggerDelivery: createAgentTriggerDeliveryModel(mongoose),
    AgentTriggerLaneSequence: createAgentTriggerLaneSequenceModel(mongoose),
    AgentTriggerUserPurge: createAgentTriggerUserPurgeModel(mongoose),
    AgentQueuedTurn: createAgentQueuedTurnModel(mongoose),
    AgentQueuedTurnSequence: createAgentQueuedTurnSequenceModel(mongoose),
    Schedule: createScheduleModel(mongoose),
    ScheduleRun: createScheduleRunModel(mongoose),
    RefreshTokenBridge: createRefreshTokenBridgeModel(mongoose),
    OpenIDRefreshFlight: createOpenIDRefreshFlightModel(mongoose),
    Organization: createOrganizationModel(mongoose),
    Membership: createMembershipModel(mongoose),
    Workspace: createWorkspaceModel(mongoose),
    MessagePart: createMessagePartModel(mongoose),
    AgentRun: createAgentRunModel(mongoose),
    Notification: createNotificationModel(mongoose),
    Tool: createToolModel(mongoose),
    ToolVersion: createToolVersionModel(mongoose),
    ToolPermission: createToolPermissionModel(mongoose),
    Source: createSourceModel(mongoose),
    Citation: createCitationModel(mongoose),
    Artifact: createArtifactModel(mongoose),
    ArtifactVersion: createArtifactVersionModel(mongoose),
    Workflow: createWorkflowModel(mongoose),
    WorkflowRun: createWorkflowRunModel(mongoose),
    Device: createDeviceModel(mongoose),
    Subscription: createSubscriptionModel(mongoose),
    UsageRecord: createUsageRecordModel(mongoose),
    Feedback: createFeedbackModel(mongoose),
  };
  /**
   * Background index builds fail silently unless an 'index' listener is
   * attached (e.g. Amazon DocumentDB <5.0 rejecting partialFilterExpression),
   * leaving unique constraints unenforced with no trace in the logs.
   */
  for (const model of Object.values(models)) {
    if (model.listenerCount('index') === 0) {
      model.on('index', (error?: Error) => {
        if (error) {
          logger.error(`Index build failed for "${model.modelName}": ${error.message}`);
        }
      });
    }
  }
  return models;
}
