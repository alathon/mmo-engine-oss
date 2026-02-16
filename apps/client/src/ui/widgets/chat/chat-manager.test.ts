import { describe, expect, it } from "vitest";
import { ChatManager } from "./chat-manager";
import type { ChatEventSource } from "./chat-event-source";

class FakeChatSource implements ChatEventSource {
  private messageHandler?: (playerId: string, playerName: string, message: string) => void;
  private systemHandler?: (message: string) => void;
  public sent: string[] = [];

  onMessage(callback: (playerId: string, playerName: string, message: string) => void): void {
    this.messageHandler = callback;
  }

  onSystemMessage(callback: (message: string) => void): void {
    this.systemHandler = callback;
  }

  sendMessage(message: string): void {
    this.sent.push(message);
  }

  emitMessage(playerId: string, playerName: string, message: string): void {
    this.messageHandler?.(playerId, playerName, message);
  }

  emitSystem(message: string): void {
    this.systemHandler?.(message);
  }
}

describe("ChatManager", () => {
  it("forwards messages and sends chat", () => {
    const source = new FakeChatSource();
    const chat = new ChatManager(source);

    const received: [string, string, string][] = [];
    const system: string[] = [];

    chat.onChatMessage((playerId, playerName, message) => {
      received.push([playerId, playerName, message]);
    });

    chat.onSystemMessage((message) => {
      system.push(message);
    });

    source.emitMessage("p1", "Alice", "Hello");
    source.emitSystem("Server ready");
    chat.sendChatMessage("Hi there");
    chat.addSystemMessage("Local notice");

    expect(received).toEqual([["p1", "Alice", "Hello"]]);
    expect(system).toEqual(["Server ready", "Local notice"]);
    expect(source.sent).toEqual(["Hi there"]);
  });
});
