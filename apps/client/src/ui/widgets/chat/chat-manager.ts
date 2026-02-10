import type { ChatEventEmitter, ChatEventSource } from './chat-event-source';

export class ChatManager implements ChatEventEmitter {
  private chatMessageHandlers: ((playerId: string, playerName: string, message: string) => void)[] =
    [];
  private systemMessageHandlers: ((message: string) => void)[] = [];
  private disposed = false;

  constructor(private chatSource: ChatEventSource) {
    this.chatSource.onMessage((playerId, playerName, message) => {
      if (this.disposed) {
        return;
      }
      for (const handler of this.chatMessageHandlers) {
        handler(playerId, playerName, message);
      }
    });

    this.chatSource.onSystemMessage((message) => {
      if (this.disposed) {
        return;
      }
      this.addSystemMessage(message);
    });
  }

  onChatMessage(handler: (playerId: string, playerName: string, message: string) => void): void {
    this.chatMessageHandlers.push(handler);
  }

  onSystemMessage(handler: (message: string) => void): void {
    this.systemMessageHandlers.push(handler);
  }

  sendChatMessage(message: string): void {
    this.chatSource.sendMessage(message);
  }

  addSystemMessage(message: string): void {
    for (const handler of this.systemMessageHandlers) {
      handler(message);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.chatMessageHandlers = [];
    this.systemMessageHandlers = [];
  }
}
