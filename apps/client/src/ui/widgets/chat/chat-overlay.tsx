import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { BattleLine, ChatLine, ChatViewModel } from './chat-view-model';
import { useWidgetLayout } from '../../layout/use-widget-layout';

type ChatTab = 'chat' | 'battle';

const useChatSnapshot = (viewModel: ChatViewModel) => {
  const subscribe = useCallback(
    (listener: () => void) => viewModel.subscribe(listener),
    [viewModel]
  );
  const getSnapshot = useCallback(() => viewModel.getSnapshot(), [viewModel]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const ChatOverlay = ({ viewModel }: { viewModel: ChatViewModel }) => {
  const snapshot = useChatSnapshot(viewModel);
  const { style, dragHandlers } = useWidgetLayout('hud.chat');
  const [activeTab, setActiveTab] = useState<ChatTab>('chat');
  const [chatDirty, setChatDirty] = useState(false);
  const [battleDirty, setBattleDirty] = useState(false);
  const lastChatCount = useRef(snapshot.chatMessages.length);
  const lastBattleCount = useRef(snapshot.battleMessages.length);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const battleMessagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const count = snapshot.chatMessages.length;
    if (count > lastChatCount.current && activeTab !== 'chat') {
      setChatDirty(true);
    }
    lastChatCount.current = count;
  }, [activeTab, snapshot.chatMessages.length]);

  useEffect(() => {
    const count = snapshot.battleMessages.length;
    if (count > lastBattleCount.current && activeTab !== 'battle') {
      setBattleDirty(true);
    }
    lastBattleCount.current = count;
  }, [activeTab, snapshot.battleMessages.length]);

  useEffect(() => {
    if (activeTab !== 'chat') {
      return;
    }
    const container = chatMessagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeTab, snapshot.chatMessages.length]);

  useEffect(() => {
    if (activeTab !== 'battle') {
      return;
    }
    const container = battleMessagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeTab, snapshot.battleMessages.length]);

  const sendMessage = useCallback(
    (preserveFocus: boolean) => {
      const input = inputRef.current;
      if (!input) {
        return;
      }

      const message = input.value.trim();
      if (!message) {
        if (!preserveFocus) {
          input.blur();
        }
        return;
      }

      viewModel.sendChatMessage(message);
      input.value = '';
      if (!preserveFocus) {
        input.blur();
      }
    },
    [viewModel]
  );

  const handleChatKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage(false);
      }
    },
    [sendMessage]
  );

  const handleSendClick = useCallback(() => {
    sendMessage(true);
  }, [sendMessage]);

  const handleUiPointerDown = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
  }, []);

  const handleChatTabClick = useCallback(() => {
    setActiveTab('chat');
    setChatDirty(false);
  }, []);

  const handleBattleTabClick = useCallback(() => {
    setActiveTab('battle');
    setBattleDirty(false);
  }, []);

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && document.activeElement !== inputRef.current) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, []);

  const chatTabClass = `chat-tab${activeTab === 'chat' ? ' active' : ''}${
    chatDirty && activeTab !== 'chat' ? ' unread' : ''
  }`;
  const battleTabClass = `chat-tab${activeTab === 'battle' ? ' active' : ''}${
    battleDirty && activeTab !== 'battle' ? ' unread' : ''
  }`;

  return (
    <div id="chat-container" data-ui-interactive="true" style={style} {...dragHandlers}>
      <div id="chat-tabs">
        <button
          id="chat-tab-chat"
          className={chatTabClass}
          type="button"
          onClick={handleChatTabClick}
          onPointerDown={handleUiPointerDown}
        >
          Chat
        </button>
        <button
          id="chat-tab-battle"
          className={battleTabClass}
          type="button"
          onClick={handleBattleTabClick}
          onPointerDown={handleUiPointerDown}
        >
          Battle
        </button>
      </div>
      <div
        id="chat-messages"
        className="chat-messages"
        ref={chatMessagesRef}
        style={{ display: activeTab === 'chat' ? 'block' : 'none' }}
      >
        {snapshot.chatMessages.map((message) => renderChatMessage(message))}
      </div>
      <div
        id="battle-messages"
        className="chat-messages"
        ref={battleMessagesRef}
        style={{ display: activeTab === 'battle' ? 'block' : 'none' }}
      >
        {snapshot.battleMessages.map((message) => renderBattleMessage(message))}
      </div>
      <div id="chat-input-container">
        <input
          id="chat-input"
          ref={inputRef}
          type="text"
          placeholder="Press Enter to chat..."
          maxLength={200}
          data-ui-input="true"
          onKeyDown={handleChatKeyDown}
        />
        <button
          id="chat-send"
          type="button"
          onClick={handleSendClick}
          onPointerDown={handleUiPointerDown}
        >
          Send
        </button>
      </div>
    </div>
  );
};

const renderChatMessage = (message: ChatLine) => {
  if (message.kind === 'system') {
    return (
      <div key={message.id} className="message system">
        {message.message}
      </div>
    );
  }

  return (
    <div key={message.id} className="message">
      <span className="player-name">{message.playerName}:</span> {message.message}
    </div>
  );
};

const renderBattleMessage = (message: BattleLine) => {
  if (typeof message.payload === 'string') {
    return (
      <div key={message.id} className="message battle">
        {message.payload}
      </div>
    );
  }

  return (
    <div key={message.id} className="message battle">
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message.payload.parts.map((part: any, index: number) => {
          if (!part.text) {
            return;
          }
          if (part.tone) {
            return (
              <span key={`${message.id}-${index}`} className={`battle-number ${part.tone}`}>
                {part.text}
              </span>
            );
          }
          return <Fragment key={`${message.id}-${index}`}>{part.text}</Fragment>;
        })
      }
    </div>
  );
};
