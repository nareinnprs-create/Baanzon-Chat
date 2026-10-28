import { Model } from 'mongoose';
import type { IEvalRunDocument } from '~/types/evalRun';
import evalRunSchema from '~/schema/evalRun';

export function createEvalRunModel(mongoose: typeof import('mongoose')): Model<IEvalRunDocument> {
  return (
    mongoose.models.EvalRun ||
    mongoose.model<IEvalRunDocument>('EvalRun', evalRunSchema, 'eval_runs')
  );
}
