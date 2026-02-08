import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { ZoneData } from "../src/world/zones/zone";
import type { ZoneDefinition } from "@mmo/shared";
import { createAuthToken } from "@mmo/shared-servers";

const AUTH_SECRET = "zone-room-test-secret";
const TEST_PORT = 27000 + (process.pid % 1000);

const createTestZoneData = (zoneId: string): ZoneData => {
  const zoneData = new ZoneData(zoneId);
  zoneData.definition = {
    id: zoneId,
    name: "Test Zone",
    sceneData: {
      width: 1,
      height: 1,
      ground: {
        color: { r: 0, g: 0, b: 0 },
      },
      terrainObjects: [],
      navmeshFilePath: "test.navmesh",
    },
  } as ZoneDefinition;
  zoneData.entryPoints = [];
  zoneData.mobSpawnPoints = [];
  zoneData.objSpawnPoints = [];
  zoneData.navmeshQuery = undefined;
  return zoneData;
};

import appConfig from "../src/appConfig";
import { Server } from "colyseus";

describe("ZoneRoom", () => {
  let colyseus: ColyseusTestServer;
  let server: Server;
  let client1: ColyseusTestServer | undefined;
  let client2: ColyseusTestServer | undefined;
  let previousSecret: string | undefined;

  beforeAll(async () => {
    previousSecret = process.env.AUTH_TOKEN_SECRET;
    process.env.AUTH_TOKEN_SECRET = AUTH_SECRET;
    if (appConfig instanceof Server) {
      await appConfig.listen(TEST_PORT);
      server = appConfig;
      colyseus = new ColyseusTestServer(server);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      colyseus = await boot<any>(appConfig, TEST_PORT);
      server = colyseus.server;
    }
    client1 = new ColyseusTestServer(server);
    client2 = new ColyseusTestServer(server);
  });

  afterAll(async () => {
    process.env.AUTH_TOKEN_SECRET = previousSecret;
    await colyseus.shutdown();
    if (client1 != undefined) await client1.shutdown();
    if (client2 != undefined) await client2.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
    if (client1) {
      await client1?.cleanup();
      client1.sdk.auth.token = createAuthToken({
        playerId: "player-a",
        displayName: "Player A",
      });
    }
    if (client2) {
      await client2?.cleanup();
      client2.sdk.auth.token = createAuthToken({
        playerId: "player-b",
        displayName: "Player B",
      });
    }
  });

  it("creates player state on join", async () => {
    const room = await colyseus.createRoom("zone", {
      zoneData: createTestZoneData("test-zone"),
    });

    if (client1 === undefined) {
      throw new Error("client1 is undefined");
    }

    const client = await client1.connectTo(room);

    await room.waitForNextPatch();

    const playerState = room.state.players.get("player-a");
    expect(room.state.zoneId).toBe("test-zone");
    expect(playerState).toBeDefined();
    expect(playerState?.sessionId).toBe(client.sessionId);
    expect(playerState?.isDisconnected).toBe(false);
  });

  it("rejects connections without an auth token", async () => {
    const room = await colyseus.createRoom("zone", {
      zoneData: createTestZoneData("test-zone"),
    });
    await expect(colyseus.connectTo(room, {})).rejects.toThrow(
      /missing auth token/i,
    );
  });

  it("marks a player disconnected on leave", async () => {
    const room = await colyseus.createRoom("zone", {
      zoneData: createTestZoneData("test-zone"),
    });

    if (!client1) {
      throw new Error("client1 is undefined");
    }

    const clientA = await client1.connectTo(room);

    await room.waitForNextPatch();

    await clientA.leave();
    await room.waitForNextSimulationTick();

    const playerState = room.state.players.get("player-a");
    expect(playerState?.isDisconnected).toBe(true);
    expect(playerState?.sessionId).toBe("");
  });
});
