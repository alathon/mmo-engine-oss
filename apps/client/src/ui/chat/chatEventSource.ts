export interface ChatEventEmitter {
  onChatMessage(
    handler: (playerId: string, playerName: string, message: string) => void,
  ): void;
  onSystemMessage(handler: (message: string) => void): void;
  sendChatMessage(message: string): void;
}

export interface ChatEventSource {
  onMessage(
    callback: (playerId: string, playerName: string, message: string) => void,
  ): void;
  onSystemMessage(callback: (message: string) => void): void;
  sendMessage(message: string): void;
}
