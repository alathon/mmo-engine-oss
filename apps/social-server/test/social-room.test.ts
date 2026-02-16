import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { Server } from "colyseus";
import jwt from "jsonwebtoken";
import type { ChatBroadcast } from "@mmo/shared";
import { createAuthToken } from "@mmo/shared-servers";
import appConfig from "../src/app-config";

const AUTH_SECRET = "social-room-test-secret";
const TEST_PORT = 26_000 + (process.pid % 1000);

describe("SocialRoom", () => {
  let colyseus: ColyseusTestServer;
  let previousSecret: string | undefined;

  beforeAll(async () => {
    previousSecret = process.env.AUTH_TOKEN_SECRET;
    process.env.AUTH_TOKEN_SECRET = AUTH_SECRET;
    if (appConfig instanceof Server) {
      await appConfig.listen(TEST_PORT);
      colyseus = new ColyseusTestServer(appConfig);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      colyseus = await boot<any>(appConfig, TEST_PORT);
    }
  });

  afterAll(async () => {
    process.env.AUTH_TOKEN_SECRET = previousSecret;
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    colyseus.sdk.auth.token = "";
    await colyseus.cleanup();
  });

  it("rejects connections without an auth token", async () => {
    const room = await colyseus.createRoom("social");
    await expect(colyseus.connectTo(room)).rejects.toThrow(/missing auth token/i);
  });

  it("rejects tokens missing required fields", async () => {
    const room = await colyseus.createRoom("social");
    const token = createAuthToken({ displayName: "" });
    colyseus.sdk.auth.token = token;
    await expect(colyseus.connectTo(room)).rejects.toThrow(/missing required fields/i);
  });

  it("rejects tokens with invalid signatures", async () => {
    const room = await colyseus.createRoom("social");
    const token = jwt.sign(
      { playerId: "player-2", displayName: "Invalid Signature" },
      "wrong-secret",
    );
    colyseus.sdk.auth.token = token;
    await expect(colyseus.connectTo(room)).rejects.toThrow(/invalid signature/i);
  });

  it("works", async () => {
    const room = await colyseus.createRoom("social");
    const token1 = createAuthToken({
      playerId: "player-1",
      displayName: "Player 1",
    });

    const token2 = createAuthToken({
      playerId: "player-2",
      displayName: "Player 2",
    });
    colyseus.sdk.auth.token = token1;
    const client1 = await colyseus.connectTo(room);
    colyseus.sdk.auth.token = token2;
    const client2 = await colyseus.connectTo(room);

    const msg = "Hi there";
    client1.send("chat", { channel: "global", message: msg });
    const payload = (await client2.waitForMessage("chat")) as ChatBroadcast;
    expect(payload).toEqual({
      channel: "global",
      message: "Hi there",
      senderId: "player-1",
      senderName: "Player 1",
      recipientId: undefined,
    });
  });

  it("broadcasts trimmed chat messages and normalizes invalid channels", async () => {
    const room = await colyseus.createRoom("social");
    const token1 = createAuthToken({
      playerId: "sender-1",
      displayName: "Sender",
    });
    const token2 = createAuthToken({
      playerId: "recipient-1",
      displayName: "Recipient",
    });

    colyseus.sdk.auth.token = token1;
    const sender = await colyseus.connectTo(room);
    colyseus.sdk.auth.token = token2;
    const recipient = await colyseus.connectTo(room);

    const rawMessage = `   ${"x".repeat(240)}   `;
    sender.send("chat", {
      channel: "unknown",
      message: rawMessage,
      recipientId: "recipient-1",
    });

    const payload = (await recipient.waitForMessage("chat")) as ChatBroadcast;
    expect(payload.channel).toBe("global");
    expect(payload.senderId).toBe("sender-1");
    expect(payload.senderName).toBe("Sender");
    expect(payload.recipientId).toBe("recipient-1");
    expect(payload.message).toBe(rawMessage.trim().slice(0, 200));
  });

  it("broadcasts chat to multiple recipients", async () => {
    const room = await colyseus.createRoom("social");
    colyseus.sdk.auth.token = createAuthToken({
      playerId: "sender-multi",
      displayName: "Sender",
    });
    const sender = await colyseus.connectTo(room);
    colyseus.sdk.auth.token = createAuthToken({
      playerId: "recipient-a",
      displayName: "Recipient A",
    });
    const recipientA = await colyseus.connectTo(room);
    colyseus.sdk.auth.token = createAuthToken({
      playerId: "recipient-b",
      displayName: "Recipient B",
    });
    const recipientB = await colyseus.connectTo(room);

    const waitA = recipientA.waitForMessage("chat");
    const waitB = recipientB.waitForMessage("chat");

    sender.send("chat", { channel: "global", message: "hello everyone" });

    const [payloadA, payloadB] = (await Promise.all([waitA, waitB])) as ChatBroadcast[];

    expect(payloadA.message).toBe("hello everyone");
    expect(payloadB.message).toBe("hello everyone");
    expect(payloadA.senderId).toBe("sender-multi");
    expect(payloadB.senderId).toBe("sender-multi");
  });

  it("ignores empty chat messages", async () => {
    const room = await colyseus.createRoom("social");
    colyseus.sdk.auth.token = createAuthToken({
      playerId: "sender-2",
      displayName: "Sender",
    });
    const sender = await colyseus.connectTo(room);
    colyseus.sdk.auth.token = createAuthToken({
      playerId: "recipient-2",
      displayName: "Recipient",
    });
    const recipient = await colyseus.connectTo(room);

    sender.send("chat", { channel: "global", message: "   " });

    await expect(recipient.waitForMessage("chat", 75)).rejects.toThrow(
      /message 'chat' was not called/i,
    );
  });

  it("preserves whisper channels and recipients", async () => {
    const room = await colyseus.createRoom("social");
    colyseus.sdk.auth.token = createAuthToken({
      playerId: "sender-3",
      displayName: "Sender",
    });
    const sender = await colyseus.connectTo(room);
    colyseus.sdk.auth.token = createAuthToken({
      playerId: "recipient-3",
      displayName: "Recipient",
    });
    const recipient = await colyseus.connectTo(room);

    sender.send("chat", {
      channel: "whisper",
      message: "psst",
      recipientId: "recipient-3",
    });

    const payload = (await recipient.waitForMessage("chat")) as ChatBroadcast;
    expect(payload.channel).toBe("whisper");
    expect(payload.recipientId).toBe("recipient-3");
  });
});
