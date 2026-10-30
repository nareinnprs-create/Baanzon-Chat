import type { TFeedbackRating } from 'librechat-data-provider';

/** One lane's end-of-run state as observed by the Arena panel. Both lanes of
 *  an addedConvo wave share one conversation, so the ids usually match — the
 *  helper never assumes that. */
export type ArenaLaneState = {
  /** Raw model id (written back onto the conversation when this lane wins). */
  model: string | null;
  /** Model spec name the lane was configured with, if any. */
  spec: string | null;
  /** Display name (spec label or model id) shown on the vote button. */
  label: string;
  /** messageId of the lane's latest message. */
  latestMessageId: string | null;
  error: boolean;
  isUserMessage: boolean;
};

export type ArenaVoteChoice = 'lane0' | 'lane1' | 'tie';

export type ArenaVotePayload = {
  conversationId: string;
  /** Message the feedback mutation records the vote on. */
  messageId: string;
  /** What to continue the conversation with; null for a tie. */
  winner: { model: string | null; spec: string | null; label: string } | null;
  feedback: {
    rating: TFeedbackRating;
    tag: 'accurate_reliable';
    text: string;
  };
};

/**
 * The feedback endpoint zod-validates `tag` against the fixed reason registry
 * (packages/data-provider/src/feedback.ts), so an invented 'arena-winner' tag
 * would 400 on the server. The arena marker travels in `text` instead, next
 * to the winning model name; the tag itself is a valid positive reason.
 */
export function buildArenaVotePayload({
  conversationId,
  lane0,
  lane1,
  choice,
}: {
  conversationId: string | null | undefined;
  lane0: ArenaLaneState;
  lane1: ArenaLaneState;
  choice: ArenaVoteChoice;
}): ArenaVotePayload | null {
  const convoId = conversationId != null && conversationId !== '' ? conversationId : null;
  const ready = (lane: ArenaLaneState) =>
    convoId != null && lane.latestMessageId != null && !lane.error && !lane.isUserMessage;

  if (convoId == null || !ready(lane0) || !ready(lane1)) {
    return null;
  }

  if (choice === 'tie') {
    return {
      conversationId: convoId,
      messageId: lane0.latestMessageId as string,
      winner: null,
      feedback: {
        rating: 'thumbsUp',
        tag: 'accurate_reliable',
        text: `arena-tie: ${lane0.label} vs ${lane1.label}`,
      },
    };
  }

  const winner = choice === 'lane0' ? lane0 : lane1;
  return {
    conversationId: convoId,
    messageId: winner.latestMessageId as string,
    winner: { model: winner.model, spec: winner.spec, label: winner.label },
    feedback: {
      rating: 'thumbsUp',
      tag: 'accurate_reliable',
      text: `arena-winner: ${winner.label}`,
    },
  };
}

/** Display name for a lane: spec label wins, then the raw model id. */
export function getArenaLaneLabel(
  convo: { model?: string | null; spec?: string | null } | null | undefined,
  modelSpecs: { name: string; label?: string }[] | undefined,
): string {
  if (convo?.spec) {
    const spec = modelSpecs?.find((s) => s.name === convo.spec);
    return spec?.label ?? convo.spec;
  }
  return convo?.model || '—';
}
