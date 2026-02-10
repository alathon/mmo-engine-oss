import type { CombatLogMessage } from '../../../combat/log';
import type { ChatEventEmitter } from './chat-event-source';

export type BattleMessagePayload = CombatLogMessage | string;

export type ChatLine =
  | {
      id: number;
      kind: 'chat';
      playerId: string;
      playerName: string;
      message: string;
    }
  | {
      id: number;
      kind: 'system';
      message: string;
    };

export interface BattleLine {
  id: number;
  payload: BattleMessagePayload;
}

export interface ChatViewSnapshot {
  chatMessages: ChatLine[];
  battleMessages: BattleLine[];
}

const MAX_CHAT_MESSAGES = 500;
const MAX_BATTLE_MESSAGES = 500;

type Listener = () => void;

export class ChatViewModel {
  private chatMessages: ChatLine[] = [];
  private battleMessages: BattleLine[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;
  private snapshot: ChatViewSnapshot;
  private disposed = false;

  constructor(private chat: ChatEventEmitter) {
    this.snapshot = this.buildSnapshot();

    this.chat.onChatMessage((playerId, playerName, message) => {
      if (this.disposed) {
        return;
      }
      this.appendChatMessage({
        id: this.nextId++,
        kind: 'chat',
        playerId,
        playerName,
        message,
      });
    });

    this.chat.onSystemMessage((message) => {
      if (this.disposed) {
        return;
      }
      this.appendChatMessage({
        id: this.nextId++,
        kind: 'system',
        message,
      });
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ChatViewSnapshot {
    return this.snapshot;
  }

  sendChatMessage(message: string): void {
    this.chat.sendChatMessage(message);
  }

  addBattleMessage(message: BattleMessagePayload): void {
    if (this.disposed) {
      return;
    }

    this.battleMessages = [...this.battleMessages, { id: this.nextId++, payload: message }];
    if (this.battleMessages.length > MAX_BATTLE_MESSAGES) {
      this.battleMessages = this.battleMessages.slice(-MAX_BATTLE_MESSAGES);
    }
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.chatMessages = [];
    this.battleMessages = [];
    this.snapshot = this.buildSnapshot();
  }

  private appendChatMessage(message: ChatLine): void {
    this.chatMessages = [...this.chatMessages, message];
    if (this.chatMessages.length > MAX_CHAT_MESSAGES) {
      this.chatMessages = this.chatMessages.slice(-MAX_CHAT_MESSAGES);
    }
    this.emit();
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildSnapshot(): ChatViewSnapshot {
    return {
      chatMessages: this.chatMessages,
      battleMessages: this.battleMessages,
    };
  }
}
