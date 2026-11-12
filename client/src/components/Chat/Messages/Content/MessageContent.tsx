import { memo, Suspense, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { Constants } from 'librechat-data-provider';
import { Alert, DelayedRender } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import type { TMessageContentProps, TDisplayProps } from '~/common';
import useSmoothStreaming from '~/hooks/Messages/useSmoothStreaming';
import Error from '~/components/Messages/Content/Error';
import ToolCallLimitNotice from './ToolCallLimitNotice';
import CollapsibleText from './Parts/CollapsibleText';
import { useMessageContext } from '~/Providers';
import EmptyText from './Parts/EmptyText';
import MarkdownLite from './MarkdownLite';
import EditMessage from './EditMessage';
import Thinking from './Parts/Thinking';
import { useLocalize } from '~/hooks';
import Container from './Container';
import Markdown from './Markdown';
import { cn } from '~/utils';
import store from '~/store';

const ERROR_CONNECTION_TEXT = 'Error connecting to server, try refreshing the page.';
const DELAYED_ERROR_TIMEOUT = 5500;
const UNFINISHED_DELAY = 250;

const parseThinkingContent = (text: string) => {
  const thinkingMatch = text.match(/:::thinking([\s\S]*?):::/);
  return {
    thinkingContent: thinkingMatch ? thinkingMatch[1].trim() : '',
    regularContent: thinkingMatch ? text.replace(/:::thinking[\s\S]*?:::/, '').trim() : text,
  };
};

const LoadingFallback = () => (
  <div className="mb-[0.625rem]">
    <EmptyText underHeaderIcon />
  </div>
);

const ErrorBox = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    role="alert"
    aria-live="assertive"
    className={cn(
      'rounded-xl border border-status-error-border bg-status-error-subtle px-3 py-2 text-sm text-text-secondary',
      className,
    )}
  >
    {children}
  </div>
);

const ConnectionError = ({ message }: { message?: TMessage }) => {
  const localize = useLocalize();

  return (
    <Suspense fallback={<LoadingFallback />}>
      <DelayedRender delay={DELAYED_ERROR_TIMEOUT}>
        <Container message={message}>
          <Alert variant="error" icon={false} className="mt-2 shadow-sm transition-all">
            {localize('com_ui_error_connection')}
          </Alert>
        </Container>
      </DelayedRender>
    </Suspense>
  );
};

export const ErrorMessage = ({
  text,
  message,
  className = '',
}: Pick<TDisplayProps, 'text' | 'className'> & { message?: TMessage }) => {
  if (text === ERROR_CONNECTION_TEXT) {
    return <ConnectionError message={message} />;
  }

  return (
    <Container message={message}>
      <ErrorBox className={className}>
        <Error text={text} />
      </ErrorBox>
    </Container>
  );
};

const DisplayMessage = ({ text, isCreatedByUser, message, showCursor }: TDisplayProps) => {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  const enableUserMsgMarkdown = useRecoilValue(store.enableUserMsgMarkdown);
  const collapseLongUserMessages = useRecoilValue(store.collapseLongUserMessages);
  const smoothStreaming = useSmoothStreaming();

  // The word fade itself indicates streaming, so the trailing block cursor
  // only shows when the fade is unavailable (setting off or reduced motion).
  const showCursorState = useMemo(
    () => showCursor === true && isSubmitting && !(smoothStreaming && !isCreatedByUser),
    [showCursor, isSubmitting, smoothStreaming, isCreatedByUser],
  );

  const content = useMemo(() => {
    if (!isCreatedByUser) {
      return <Markdown content={text} isLatestMessage={isLatestMessage} />;
    }
    if (enableUserMsgMarkdown) {
      return <MarkdownLite content={text} />;
    }
    return <>{text}</>;
  }, [isCreatedByUser, enableUserMsgMarkdown, text, isLatestMessage]);

  return (
    <Container message={message}>
      <CollapsibleText enabled={isCreatedByUser && collapseLongUserMessages}>
        <div
          className={cn(
            'markdown prose message-content dark:prose-invert light w-full break-words',
            isSubmitting && 'submitting',
            showCursorState && text.length > 0 && 'result-streaming',
            isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
            'text-text-primary',
            // B2 editorial responses (blueprint §63.8): assistant answers read
            // like typeset content, not chat bubbles. User messages stay plain.
            !isCreatedByUser &&
              'prose-p:my-3 prose-li:my-1 prose-headings:mt-5 prose-headings:mb-2 prose-blockquote:border-l-2 prose-blockquote:not-italic max-w-[46rem] leading-[1.65]',
            // B3 kinetic coherence: new messages settle in once (mount-only),
            // within the blueprint motion budget, and stay still under
            // prefers-reduced-motion.
            'motion-safe:duration-300 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1',
          )}
        >
          {content}
        </div>
      </CollapsibleText>
    </Container>
  );
};

export const UnfinishedMessage = ({ message }: { message: TMessage }) => {
  const localize = useLocalize();

  /** Ran out of steps, not broken: a distinct, actionable card rather than the
   *  generic "something went wrong, try again" warning. */
  if (message.finish_reason === Constants.TOOL_CALL_LIMIT_FINISH_REASON) {
    return (
      <Container message={message}>
        <ToolCallLimitNotice message={message} />
      </Container>
    );
  }

  return <ErrorMessage message={message} text={localize('com_ui_response_incomplete')} />;
};

const MessageContent = ({
  text,
  edit,
  error,
  unfinished,
  isSubmitting,
  isLast,
  ...props
}: TMessageContentProps) => {
  const { message } = props;
  const { messageId } = message;

  const { thinkingContent, regularContent } = useMemo(() => parseThinkingContent(text), [text]);
  const showRegularCursor = useMemo(() => isLast && isSubmitting, [isLast, isSubmitting]);

  const unfinishedMessage = useMemo(
    () =>
      !isSubmitting && unfinished ? (
        <Suspense>
          <DelayedRender delay={UNFINISHED_DELAY}>
            <UnfinishedMessage message={message} />
          </DelayedRender>
        </Suspense>
      ) : null,
    [isSubmitting, unfinished, message],
  );

  if (error) {
    return <ErrorMessage message={message} text={text} />;
  }

  if (edit) {
    return <EditMessage text={text} isSubmitting={isSubmitting} {...props} />;
  }

  return (
    <>
      {thinkingContent.length > 0 && (
        <Thinking key={`thinking-${messageId}`}>{thinkingContent}</Thinking>
      )}
      <DisplayMessage
        key={`display-${messageId}`}
        showCursor={showRegularCursor}
        text={regularContent}
        {...props}
      />
      {unfinishedMessage}
    </>
  );
};

const MemoizedMessageContent = memo(MessageContent);
MemoizedMessageContent.displayName = 'MessageContent';

export default MemoizedMessageContent;
