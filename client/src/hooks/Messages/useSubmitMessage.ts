import { useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { replaceSpecialVars } from 'librechat-data-provider';
import type { ModelLane, TMessage } from 'librechat-data-provider';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useGetStartupConfig } from '~/data-provider';
import { pickSmartModel } from '~/utils/smartRoute';
import { smartRouteEnabled } from '~/store/settings';
import { useGetLatestMessage } from '~/hooks/Messages/useLatestMessage';
import useOfflineQueue from '~/hooks/useOfflineQueue';
import { useAuthContext } from '~/hooks/AuthContext';
import { mainTextareaId } from '~/common';
import store from '~/store';
import { useAtomValue } from 'jotai';
import { selectedModelLaneAtom } from '~/store/modelLane';

export default function useSubmitMessage() {
  const { user } = useAuthContext();
  const methods = useChatFormContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const { ask, index, getMessages, setMessages, conversation } = useChatContext();
  const getLatestMessage = useGetLatestMessage(index);
  const offline = useOfflineQueue({
    conversationId: conversation?.conversationId ?? null,
    send: async (item) => {
      const submitted = ask({ text: item.text }, { overrideLane: item.lane });
      if (submitted === false) {
        /** Refused, not accepted: keep the item queued rather than silently dropping it. */
        throw new Error('Queued message was not accepted');
      }
      methods.reset();
    },
  });

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));
  /** X5 Smart Route: read the toggle + specs here, resolve per-send below so
   *  the heuristic always sees the exact text being submitted. */
  const smartRouteOn = useAtomValue(smartRouteEnabled);
  const { data: startupConfig } = useGetStartupConfig();
  const selectedModelLane = useAtomValue(selectedModelLaneAtom);
  const modelSpecsList = startupConfig?.modelSpecs?.list;

  const submitMessage = useCallback(
    (data?: {
      text: string;
      overrideFiles?: TMessage['files'];
      overrideQuotes?: string[];
      overrideManualSkills?: string[];
      overrideClientRequestId?: string;
      overrideRecoverySteerId?: string;
      overrideExpectedPredecessorCreatedAt?: number;
      overrideQueuedMessageOrigin?: unknown;
      overrideLane?: ModelLane;
    }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }
      /** Offline: park the send in IndexedDB and leave the composer (and its draft) in place,
       *  so the text is restored on the next mount and the queue drains on reconnect.
       *  Attachments are not queued by this slice — only the text travels. */
      if (offline.isOnline === false) {
        void offline.enqueueSend({
          text: data.text,
          lane: data.overrideLane ?? selectedModelLane ?? undefined,
        });
        return false;
      }
      const latestMessage = getLatestMessage();
      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }

      const submitted = ask(
        {
          text: data.text,
          ...(data.overrideRecoverySteerId != null && {
            overrideUserMessageId: data.overrideRecoverySteerId,
          }),
        },
        {
          addedConvo: addedConvo ?? undefined,
          overrideModel:
            smartRouteOn && modelSpecsList
              ? (pickSmartModel(
                  data.text,
                  modelSpecsList,
                  conversation?.endpoint,
                  conversation?.model,
                ) ?? undefined)
              : undefined,
          overrideLane: data.overrideLane ?? selectedModelLane ?? undefined,
          // Queued during-run messages carry their own consumed attachments,
          // quote chips, and manual skill picks (undefined = drain composer).
          overrideFiles: data.overrideFiles,
          overrideQuotes: data.overrideQuotes,
          overrideManualSkills: data.overrideManualSkills,
          overrideClientRequestId: data.overrideClientRequestId,
          overrideRecoverySteerId: data.overrideRecoverySteerId,
          overrideExpectedPredecessorCreatedAt: data.overrideExpectedPredecessorCreatedAt,
          overrideQueuedMessageOrigin: data.overrideQueuedMessageOrigin,
        },
      );
      if (submitted === false) {
        return false;
      }
      methods.reset();
    },
    [
      ask,
      methods,
      addedConvo,
      setMessages,
      getMessages,
      getLatestMessage,
      conversation,
      offline,
      selectedModelLane,
      smartRouteOn,
      modelSpecsList,
    ],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      const currentText = textarea?.value ?? methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
