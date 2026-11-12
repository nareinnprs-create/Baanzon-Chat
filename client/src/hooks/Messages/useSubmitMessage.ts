import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { useToastContext } from '@librechat/client';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { replaceSpecialVars } from 'librechat-data-provider';
import type { ModelLane, TMessage } from 'librechat-data-provider';
import { generateImageFile, isImageRequest, uploadGeneratedImage } from '~/utils/imageIntent';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useGetLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { selectedModelLaneAtom } from '~/store/modelLane';
import { useGetStartupConfig } from '~/data-provider';
import useOfflineQueue from '~/hooks/useOfflineQueue';
import { smartRouteEnabled } from '~/store/settings';
import { useAuthContext } from '~/hooks/AuthContext';
import { pickSmartModel } from '~/utils/smartRoute';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';
import store from '~/store';

type Submission = {
  text: string;
  overrideFiles?: TMessage['files'];
  overrideQuotes?: string[];
  overrideManualSkills?: string[];
  overrideClientRequestId?: string;
  overrideRecoverySteerId?: string;
  overrideExpectedPredecessorCreatedAt?: number;
  overrideQueuedMessageOrigin?: unknown;
  overrideLane?: ModelLane;
};

export default function useSubmitMessage() {
  const { user } = useAuthContext();
  const methods = useChatFormContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const { ask, index, getMessages, setMessages, conversation, files } = useChatContext();
  const getLatestMessage = useGetLatestMessage(index);
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const isTemporary = useRecoilValue(store.isTemporary);
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
    (data?: Submission) => {
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

      /** Sync tail shared by the direct send and the image-intent flow: the
       *  reconciliation, ask, and composer reset all read state at call time. */
      const performSend = (submission: Submission) => {
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
            text: submission.text,
            ...(submission.overrideRecoverySteerId != null && {
              overrideUserMessageId: submission.overrideRecoverySteerId,
            }),
          },
          {
            addedConvo: addedConvo ?? undefined,
            overrideModel:
              smartRouteOn && modelSpecsList
                ? (pickSmartModel(
                    submission.text,
                    modelSpecsList,
                    conversation?.endpoint,
                    conversation?.model,
                  ) ?? undefined)
                : undefined,
            overrideLane: submission.overrideLane ?? selectedModelLane ?? undefined,
            // Queued during-run messages carry their own consumed attachments,
            // quote chips, and manual skill picks (undefined = drain composer).
            overrideFiles: submission.overrideFiles,
            overrideQuotes: submission.overrideQuotes,
            overrideManualSkills: submission.overrideManualSkills,
            overrideClientRequestId: submission.overrideClientRequestId,
            overrideRecoverySteerId: submission.overrideRecoverySteerId,
            overrideExpectedPredecessorCreatedAt: submission.overrideExpectedPredecessorCreatedAt,
            overrideQueuedMessageOrigin: submission.overrideQueuedMessageOrigin,
          },
        );
        if (submitted === false) {
          return false;
        }
        methods.reset();
      };

      /** Typed "generate an image…" with nothing attached: generate server-side,
       *  upload through the file pipeline, and submit with the result attached.
       *  Any failure toasts (server cap/burst message when present) and falls
       *  back to the plain chat send, so the request is never lost. */
      if (
        data.overrideFiles == null &&
        (files == null || files.size === 0) &&
        isImageRequest(data.text)
      ) {
        void (async () => {
          try {
            const file = await generateImageFile(data.text);
            const uploaded = await uploadGeneratedImage({ file, conversation, isTemporary });
            performSend({
              text: data.text,
              overrideFiles: [
                {
                  file_id: uploaded.file_id,
                  filepath: uploaded.filepath,
                  filename: uploaded.filename,
                  type: uploaded.type ?? '',
                  height: uploaded.height,
                  width: uploaded.width,
                },
              ],
            });
          } catch (err) {
            const serverMessage = (err as { serverMessage?: string }).serverMessage;
            showToast({
              message: serverMessage || localize('com_ui_image_gen_failed'),
              status: 'error',
              duration: 5000,
            });
            performSend(data);
          }
        })();
        return false;
      }

      return performSend(data);
    },
    [
      ask,
      methods,
      addedConvo,
      setMessages,
      getMessages,
      getLatestMessage,
      conversation,
      files,
      offline,
      selectedModelLane,
      smartRouteOn,
      modelSpecsList,
      showToast,
      localize,
      isTemporary,
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
