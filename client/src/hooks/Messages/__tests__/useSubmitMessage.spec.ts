import { act, renderHook } from '@testing-library/react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useGetLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useAuthContext } from '~/hooks/AuthContext';
import useSubmitMessage from '../useSubmitMessage';

const mockSetActivePrompt = jest.fn();

jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  atom: (options: Record<string, unknown>) =>
    jest.requireActual('recoil').atom({
      ...options,
      key: options.key || `use-submit-message-test-${Math.random()}`,
    }),
  atomFamily: (options: Record<string, unknown>) =>
    jest.requireActual('recoil').atomFamily({
      ...options,
      key: options.key || `use-submit-message-family-test-${Math.random()}`,
    }),
  useRecoilValue: jest.fn(),
  useSetRecoilState: jest.fn(),
}));

/** `@librechat/client` resolves through the real barrel here, which needs the
 *  data-provider's `ProviderId` — mocked away in this suite. The offline queue
 *  only consumes the toast context, so a stub keeps the module graph loadable. */
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  replaceSpecialVars: jest.fn(({ text }) => text),
  fileConfig: { checkType: jest.fn(() => true) },
  ResourceType: {
    AGENT: 'agent',
    PROMPTGROUP: 'promptGroup',
    MCPSERVER: 'mcpServer',
    REMOTE_AGENT: 'remoteAgent',
    SKILL: 'skill',
    SHARED_LINK: 'sharedLink',
  },
  AccessRoleIds: {
    AGENT_VIEWER: 'agent_viewer',
    AGENT_EDITOR: 'agent_editor',
    AGENT_OWNER: 'agent_owner',
    PROMPTGROUP_VIEWER: 'promptGroup_viewer',
    PROMPTGROUP_EDITOR: 'promptGroup_editor',
    PROMPTGROUP_OWNER: 'promptGroup_owner',
    MCPSERVER_VIEWER: 'mcpServer_viewer',
    MCPSERVER_EDITOR: 'mcpServer_editor',
    MCPSERVER_OWNER: 'mcpServer_owner',
    REMOTE_AGENT_VIEWER: 'remoteAgent_viewer',
    REMOTE_AGENT_EDITOR: 'remoteAgent_editor',
    REMOTE_AGENT_OWNER: 'remoteAgent_owner',
    SKILL_VIEWER: 'skill_viewer',
    SKILL_EDITOR: 'skill_editor',
    SKILL_OWNER: 'skill_owner',
    SHARED_LINK_VIEWER: 'sharedLink_viewer',
    SHARED_LINK_OWNER: 'sharedLink_owner',
  },
  ContentTypes: {
    TEXT: 'text',
    THINK: 'think',
    TEXT_DELTA: 'text_delta',
    TOOL_CALL: 'tool_call',
    IMAGE_FILE: 'image_file',
    IMAGE_URL: 'image_url',
    VIDEO_URL: 'video_url',
    INPUT_AUDIO: 'input_audio',
    AGENT_UPDATE: 'agent_update',
    SUMMARY: 'summary',
    ACTIVITY_LABEL: 'activity_label',
    STEER: 'steer',
    ERROR: 'error',
  },
  LocalStorageKeys: {
    LAST_MCP_: 'last_mcp_',
    LAST_CODE_TOGGLE_: 'last_code_toggle_',
    LAST_WEB_SEARCH_TOGGLE_: 'last_web_search_toggle_',
    LAST_FILE_SEARCH_TOGGLE_: 'last_file_search_toggle_',
    LAST_ARTIFACTS_TOGGLE_: 'last_artifacts_toggle_',
    LAST_MEMORY_TOGGLE_: 'last_memory_toggle_',
    PIN_MCP_: 'pin_mcp_',
  },
}));

jest.mock('~/Providers', () => ({
  useChatContext: jest.fn(),
  useChatFormContext: jest.fn(),
  useAddedChatContext: jest.fn(),
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('~/hooks/Messages/useLatestMessage', () => ({
  useGetLatestMessage: jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.fn(() => ({ data: undefined })),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    autoSendPrompts: 'autoSendPrompts',
    activePromptByIndex: jest.fn(() => 'activePromptByIndex'),
  },
}));

const mockUseRecoilValue = useRecoilValue as jest.Mock;
const mockUseSetRecoilState = useSetRecoilState as jest.Mock;
const mockUseChatContext = useChatContext as jest.Mock;
const mockUseChatFormContext = useChatFormContext as jest.Mock;
const mockUseAddedChatContext = useAddedChatContext as jest.Mock;
const mockUseAuthContext = useAuthContext as jest.Mock;
const mockUseGetLatestMessage = useGetLatestMessage as jest.Mock;

describe('useSubmitMessage', () => {
  const ask = jest.fn();
  const reset = jest.fn();
  const setMessages = jest.fn();
  const getMessages = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRecoilValue.mockReturnValue(false);
    mockUseSetRecoilState.mockReturnValue(mockSetActivePrompt);
    mockUseAuthContext.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAddedChatContext.mockReturnValue({ conversation: null });
    mockUseChatFormContext.mockReturnValue({ reset, getValues: jest.fn(() => '') });
    mockUseGetLatestMessage.mockReturnValue(() => ({ messageId: 'assistant-message' }));
    getMessages.mockReturnValue([{ messageId: 'assistant-message' }]);
    mockUseChatContext.mockReturnValue({
      ask,
      index: 0,
      getMessages,
      setMessages,
    });
  });

  it('propagates blocked submits so direct callers can preserve their text', () => {
    ask.mockReturnValue(false);

    const { result } = renderHook(() => useSubmitMessage());

    let submitted: false | void = undefined;
    act(() => {
      submitted = result.current.submitMessage({ text: 'dictated follow-up' });
    });

    expect(submitted).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('reads the tail at call time and appends it to root when missing', () => {
    const rootMessages = [{ messageId: 'root-user' }];
    const latest = { messageId: 'assistant-tail', text: 'tail' };
    const reader = jest.fn(() => latest);
    mockUseGetLatestMessage.mockReturnValue(reader);
    getMessages.mockReturnValue(rootMessages);
    ask.mockReturnValue(true);

    const { result } = renderHook(() => useSubmitMessage());
    act(() => {
      result.current.submitMessage({ text: 'hello' });
    });

    expect(reader).toHaveBeenCalled();
    expect(setMessages).toHaveBeenCalledWith([...rootMessages, latest]);
    expect(ask).toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });

  it('does not append when the latest message is already in root', () => {
    const latest = { messageId: 'assistant-tail' };
    mockUseGetLatestMessage.mockReturnValue(() => latest);
    getMessages.mockReturnValue([latest]);
    ask.mockReturnValue(true);

    const { result } = renderHook(() => useSubmitMessage());
    act(() => {
      result.current.submitMessage({ text: 'hello' });
    });

    expect(setMessages).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalled();
  });

  it('does not append when there is no latest message', () => {
    mockUseGetLatestMessage.mockReturnValue(() => null);
    getMessages.mockReturnValue([{ messageId: 'root-user' }]);
    ask.mockReturnValue(true);

    const { result } = renderHook(() => useSubmitMessage());
    act(() => {
      result.current.submitMessage({ text: 'hello' });
    });

    expect(setMessages).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalled();
  });

  it('forwards a per-turn model lane without changing conversation state', () => {
    ask.mockReturnValue(true);
    const { result } = renderHook(() => useSubmitMessage());

    act(() => {
      result.current.submitMessage({ text: 'inspect this', overrideLane: 'vision' });
    });

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'inspect this' }),
      expect.objectContaining({ overrideLane: 'vision' }),
    );
  });

  it('uses the recovery source as the stable user row and forwards the attempt fields', () => {
    ask.mockReturnValue(true);
    const { result } = renderHook(() => useSubmitMessage());

    act(() => {
      result.current.submitMessage({
        text: 'recover once',
        overrideClientRequestId: 'attempt-uuid',
        overrideRecoverySteerId: 'source-steer',
      });
    });

    expect(ask).toHaveBeenCalledWith(
      { text: 'recover once', overrideUserMessageId: 'source-steer' },
      expect.objectContaining({
        overrideClientRequestId: 'attempt-uuid',
        overrideRecoverySteerId: 'source-steer',
      }),
    );
  });
});
