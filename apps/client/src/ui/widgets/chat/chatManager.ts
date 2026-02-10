import type { ChatEventEmitter, ChatEventSource } from "./chatEventSource";

export class ChatManager implements ChatEventEmitter {
  private chatMessageHandlers: ((playerId: string, playerName: string, message: string) => void)[] = [];
  private systemMessageHandlers: ((message: string) => void)[] = [];
  private disposed = false;

  constructor(private chatSource: ChatEventSource) {
    this.chatSource.onMessage((playerId, playerName, message) => {
      if (this.disposed) {
        return;
      }
      this.chatMessageHandlers.forEach((handler) => {
        handler(playerId, playerName, message);
      });
    });

    this.chatSource.onSystemMessage((message) => {
      if (this.disposed) {
        return;
      }
      this.addSystemMessage(message);
    });
  }

  onChatMessage(
    handler: (playerId: string, playerName: string, message: string) => void,
  ): void {
    this.chatMessageHandlers.push(handler);
  }

  onSystemMessage(handler: (message: string) => void): void {
    this.systemMessageHandlers.push(handler);
  }

  sendChatMessage(message: string): void {
    this.chatSource.sendMessage(message);
  }

  addSystemMessage(message: string): void {
    this.systemMessageHandlers.forEach((handler) => {
      handler(message);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.chatMessageHandlers = [];
    this.systemMessageHandlers = [];
  }
}
