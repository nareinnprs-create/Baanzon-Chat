import { Model } from 'mongoose';
import type { IKnowledgeCollectionDoc } from '~/types/knowledge';
import {
  KNOWLEDGE_COLLECTION_NAME,
  default as knowledgeCollectionSchema,
} from '~/schema/knowledgeCollection';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createKnowledgeCollectionModel(
  mongoose: typeof import('mongoose'),
): Model<IKnowledgeCollectionDoc> {
  applyTenantIsolation(knowledgeCollectionSchema);
  return (
    mongoose.models[KNOWLEDGE_COLLECTION_NAME] ||
    mongoose.model<IKnowledgeCollectionDoc>(KNOWLEDGE_COLLECTION_NAME, knowledgeCollectionSchema)
  );
}
