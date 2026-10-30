import { useEffect, useMemo, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useUpdateFeedbackMutation } from 'librechat-data-provider/react-query';
import type { TModelSpec, TPreset, TStartupConfig } from 'librechat-data-provider';
import type { ArenaVoteChoice, ArenaVotePayload } from './votePayload';
import { buildArenaVotePayload, getArenaLaneLabel } from './votePayload';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useChatContext, useAddedChatContext } from '~/Providers';
import { getModelSpecIconURL } from '~/utils/endpoints';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

const voteButtonClasses =
  'h-8 min-w-0 flex-1 truncate rounded-lg border border-border-light bg-presentation px-2 text-xs font-medium text-text-primary transition-colors hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary';

/** Panel content for the header Arena popover: lane-2 model pick, run status,
 *  and the vote row once both lanes of the addedConvo wave have finished. */
export default function ArenaPanel({ startupConfig }: { startupConfig: TStartupConfig }) {
  const localize = useLocalize();
  const { conversation, setConversation } = useChatContext();
  const { conversation: addedConvo, generateConversation } = useAddedChatContext();

  const modelSpecs = useMemo(() => startupConfig.modelSpecs?.list ?? [], [startupConfig]);

  /** The dual wave is one submission on one stream (index 0); there is no
   *  index-1 isSubmitting or runEnd to read — the added lane rides the same
   *  SSE as the root lane. */
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(0));
  const tail0 = useLatestMessage(0);
  const tail1 = useLatestMessage(1);

  const lane0Complete =
    tail0 != null && tail0.isCreatedByUser !== true && tail0.error !== true && !isSubmitting;
  const lane1Complete =
    tail1 != null && tail1.isCreatedByUser !== true && tail1.error !== true && !isSubmitting;
  const isDual = addedConvo != null;
  const isRunning = isSubmitting && isDual;
  const canVote = isDual && !isRunning && lane0Complete && lane1Complete;

  const lane0Label = getArenaLaneLabel(conversation, modelSpecs);
  const lane1Label = getArenaLaneLabel(addedConvo, modelSpecs);

  const [voted, setVoted] = useState<ArenaVotePayload | null>(null);
  /** A vote belongs to the tail it was cast on; a new turn retires it. */
  useEffect(() => {
    setVoted(null);
  }, [tail0?.messageId]);
  const feedbackMutation = useUpdateFeedbackMutation(
    conversation?.conversationId ?? '',
    tail0?.messageId ?? '',
  );

  const lane2Specs = useMemo(
    () => modelSpecs.filter((spec) => (spec.preset.endpoint ?? '') === addedConvo?.endpoint),
    [modelSpecs, addedConvo?.endpoint],
  );
  /** Lane 2's current selection by spec name; a raw (spec-less) model falls
   *  back to the empty option, which carries its display label. */
  const lane2Value = addedConvo?.spec ?? '';

  const pickLane2Spec = (spec: TModelSpec) => {
    if (addedConvo == null || generateConversation == null) {
      return;
    }
    /** Same write path the model selector uses for the added pane: the spec
     *  preset runs through buildDefaultConvo so endpointType/params stay sane. */
    generateConversation({
      template: { ...addedConvo },
      preset: { ...spec.preset, iconURL: getModelSpecIconURL(spec), spec: spec.name } as TPreset,
    });
  };

  const vote = (choice: ArenaVoteChoice) => {
    const payload = buildArenaVotePayload({
      conversationId: conversation?.conversationId,
      lane0: {
        model: conversation?.model ?? null,
        spec: conversation?.spec ?? null,
        label: lane0Label,
        latestMessageId: tail0?.messageId ?? null,
        error: tail0?.error === true,
        isUserMessage: tail0?.isCreatedByUser === true,
      },
      lane1: {
        model: addedConvo?.model ?? null,
        spec: addedConvo?.spec ?? null,
        label: lane1Label,
        latestMessageId: tail1?.messageId ?? null,
        error: tail1?.error === true,
        isUserMessage: tail1?.isCreatedByUser === true,
      },
      choice,
    });
    if (payload == null) {
      return;
    }
    feedbackMutation.mutate(
      { feedback: payload.feedback },
      {
        onSuccess: () => {
          setVoted(payload);
          /** "Continue with winner": the winner's setup becomes the main
           *  conversation's next-turn configuration. */
          const winner = payload.winner;
          if (winner != null) {
            setConversation((prev) =>
              prev == null
                ? prev
                : { ...prev, model: winner.model ?? prev.model, spec: winner.spec ?? prev.spec },
            );
          }
        },
      },
    );
  };

  return (
    <div className="flex w-72 flex-col gap-3 text-sm text-text-primary">
      <span className="text-sm font-medium">{localize('com_ui_arena_pick')}</span>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-text-secondary" title={lane0Label}>
          {lane0Label}
        </span>
        <span className="text-text-secondary" aria-hidden="true">
          vs
        </span>
        <select
          aria-label={localize('com_ui_arena_pick')}
          value={lane2Value}
          disabled={addedConvo == null || lane2Specs.length === 0 || isRunning}
          className="h-8 max-w-[9rem] truncate rounded-lg border border-border-medium bg-transparent px-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          onChange={(event) => {
            const spec = lane2Specs.find((s) => s.name === event.target.value);
            if (spec != null) {
              pickLane2Spec(spec);
            }
          }}
        >
          <option value="">{lane1Label}</option>
          {lane2Specs.map((spec) => (
            <option key={spec.name} value={spec.name}>
              {spec.label || spec.name}
            </option>
          ))}
        </select>
      </div>

      {isRunning && (
        <p role="status" className="text-xs text-text-secondary">
          {localize('com_ui_arena_running')}
        </p>
      )}

      {canVote && (
        <div className="flex flex-col gap-2">
          <span className="sr-only">{localize('com_ui_arena_vote')}</span>
          <div className="flex gap-2">
            <button type="button" className={voteButtonClasses} onClick={() => vote('lane0')}>
              {lane0Label}
            </button>
            <button type="button" className={voteButtonClasses} onClick={() => vote('lane1')}>
              {lane1Label}
            </button>
            <button
              type="button"
              aria-label={localize('com_ui_none')}
              className={cn(voteButtonClasses, 'flex-none')}
              onClick={() => vote('tie')}
            >
              {localize('com_ui_none')}
            </button>
          </div>
          {voted != null && (
            <p role="status" className="text-xs text-text-secondary">
              ✓ {localize('com_ui_arena_vote')}
              {voted.winner != null ? `: ${voted.winner.label}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
