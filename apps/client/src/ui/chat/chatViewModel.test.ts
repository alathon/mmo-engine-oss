import { describe, expect, it } from "vitest";
import { ChatViewModel } from "./chatViewModel";
import type { ChatEventEmitter } from "./chatEventSource";

class FakeChatEmitter implements ChatEventEmitter {
  private chatHandlers: ((
    playerId: string,
    playerName: string,
    message: string,
  ) => void)[] = [];
  private systemHandlers: ((message: string) => void)[] = [];
  public sent: string[] = [];

  onChatMessage(
    handler: (playerId: string, playerName: string, message: string) => void,
  ): void {
    this.chatHandlers.push(handler);
  }

  onSystemMessage(handler: (message: string) => void): void {
    this.systemHandlers.push(handler);
  }

  sendChatMessage(message: string): void {
    this.sent.push(message);
  }

  emitChat(playerId: string, playerName: string, message: string): void {
    this.chatHandlers.forEach((handler) => {
      handler(playerId, playerName, message);
    });
  }

  emitSystem(message: string): void {
    this.systemHandlers.forEach((handler) => {
      handler(message);
    });
  }
}

describe("ChatViewModel", () => {
  it("caps chat history", () => {
    const chat = new FakeChatEmitter();
    const viewModel = new ChatViewModel(chat);

    for (let i = 0; i < 501; i += 1) {
      chat.emitChat("p1", "Alice", `msg-${i}`);
    }

    const snapshot = viewModel.getSnapshot();
    expect(snapshot.chatMessages).toHaveLength(500);
    expect(snapshot.chatMessages[0].kind).toBe("chat");
    if (snapshot.chatMessages[0].kind === "chat") {
      expect(snapshot.chatMessages[0].message).toBe("msg-1");
    }
  });
});
