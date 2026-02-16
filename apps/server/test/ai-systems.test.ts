import { beforeEach, describe, expect, it, vi } from "vitest";
import { NPCState, PlayerState, ZoneState } from "@mmo/shared";
import type { NavcatQuery } from "@mmo/shared";
import { AiDecisionSystem } from "../src/ai/systems/ai-decision-system";
import { AiSteeringSystem } from "../src/ai/systems/ai-steering-system";
import { AbilityIntentSystem } from "../src/ai/systems/ability-intent-system";
import { ServerNPC } from "../src/world/entities/npc";
import { ServerPlayer } from "../src/world/entities/player";
import { ServerZone, ZoneData } from "../src/world/zones/zone";
import { createTestNavmeshQuery } from "./test-navmesh";
import { createTestCollisionWorld } from "./test-collision-world";

const createZone = (): ServerZone => {
  const definition = {
    id: "ai-test-zone",
    name: "AI Test Zone",
    sceneData: {
      glbFilePath: "test.glb",
      terrainObjects: [],
      navmeshFilePath: "test.navmesh",
    },
  };
  const zoneData = new ZoneData(
    "ai-test-zone",
    createTestNavmeshQuery(),
    definition,
    createTestCollisionWorld("ai-test-zone"),
  );

  return new ServerZone(zoneData, new ZoneState());
};

const createPlayer = (zone: ServerZone, id: string, x = 0, z = 0): ServerPlayer => {
  const state = new PlayerState();
  state.id = id;
  state.playerId = id;
  state.x = x;
  state.z = z;
  state.name = id;
  state.factionId = "players";
  const player = new ServerPlayer(state);
  zone.players.set(id, player);
  return player;
};

const createNpc = (zone: ServerZone, id: string, x = 0, z = 0): ServerNPC => {
  const state = new NPCState();
  state.id = id;
  state.x = x;
  state.z = z;
  state.name = id;
  state.factionId = "npcs";
  const npc = new ServerNPC(state);
  zone.npcs.set(id, npc);
  return npc;
};

describe("AI systems", () => {
  let zone: ServerZone;
  let npc: ServerNPC;

  beforeEach(() => {
    zone = createZone();
    npc = createNpc(zone, "npc-1");
  });

  it("chooses wander intent when idle and ready to move", () => {
    const system = new AiDecisionSystem();
    npc.brainState.elapsedTimeMs = 1000;
    npc.brainState.nextDecisionAtMs = 0;

    const randomSpy = vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);

    system.update(zone);

    expect(npc.behaviorIntent.mode).toBe("wander");
    expect(npc.brainState.targetYaw).toBeCloseTo(Math.PI * 0.5, 6);
    expect(npc.brainState.movingUntilMs).toBe(1000 + npc.aiConfig.moveDurationMs);
    const idleMs = npc.aiConfig.minIdleMs + 0.5 * (npc.aiConfig.maxIdleMs - npc.aiConfig.minIdleMs);
    expect(npc.brainState.nextDecisionAtMs).toBe(npc.brainState.movingUntilMs + idleMs);

    randomSpy.mockRestore();
  });

  it("chooses chase intent when target is out of melee range", () => {
    const system = new AiDecisionSystem();
    const player = createPlayer(zone, "player-1", 5, 0);
    npc.brainState.elapsedTimeMs = 1000;
    npc.targetSelection.targetId = player.id;
    npc.targetSelection.targetX = player.synced.x;
    npc.targetSelection.targetZ = player.synced.z;

    system.update(zone);

    expect(npc.behaviorIntent.mode).toBe("chase");
    expect(npc.behaviorIntent.desiredRange).toBe(2);
    expect(npc.targetSelection.targetYaw).toBeCloseTo(Math.PI / 2, 6);
  });

  it("idles and faces target when within melee range", () => {
    const system = new AiDecisionSystem();
    const player = createPlayer(zone, "player-1", 1, 0);
    npc.brainState.elapsedTimeMs = 750;
    npc.targetSelection.targetId = player.id;
    npc.targetSelection.targetX = player.synced.x;
    npc.targetSelection.targetZ = player.synced.z;

    system.update(zone);

    expect(npc.behaviorIntent.mode).toBe("idle");
    expect(npc.brainState.movingUntilMs).toBe(750);
  });

  it("steers toward a smooth-path waypoint when chasing", () => {
    const system = new AiSteeringSystem();
    const navmesh = {
      findSmoothPath: () => ({
        success: true,
        path: [{ position: [0, 0, 0] }, { position: [5, 0, 0] }, { position: [10, 0, 0] }],
      }),
    } as unknown as NavcatQuery;

    npc.behaviorIntent.mode = "chase";
    npc.targetSelection.targetId = "target-1";
    npc.targetSelection.targetX = 10;
    npc.targetSelection.targetZ = 0;

    system.update(zone, navmesh);

    expect(npc.steeringIntent.directionX).toBeGreaterThan(0.9);
    expect(Math.abs(npc.steeringIntent.directionZ)).toBeLessThan(0.01);
  });

  it("steers directly to target when no waypoint is available", () => {
    const system = new AiSteeringSystem();
    const navmesh = {
      findSmoothPath: () => ({
        success: false,
        path: [],
      }),
    } as unknown as NavcatQuery;

    npc.behaviorIntent.mode = "chase";
    npc.targetSelection.targetId = "target-1";
    npc.targetSelection.targetX = 0;
    npc.targetSelection.targetZ = 5;

    system.update(zone, navmesh);

    expect(Math.abs(npc.steeringIntent.directionX)).toBeLessThan(0.01);
    expect(npc.steeringIntent.directionZ).toBeGreaterThan(0.9);
  });

  it("chases top aggro target when in combat", () => {
    const player = createPlayer(zone, "player-1", 5, 0);
    npc.aggro.addAggro(player.id, 10);
    zone.combatEngine.recordHostileAction(player, [npc], 0);

    zone.fixedTick(0, 50);

    expect(npc.behaviorIntent.mode).toBe("chase");
    expect(npc.targetSelection.targetId).toBe(player.id);
    expect(npc.steeringIntent.directionX).toBeGreaterThan(0.01);
  });

  it("consumes ability intents in the ability intent system", () => {
    const player = createPlayer(zone, "player-1", 1, 0);
    npc.abilityIntent.abilityId = "fireball";
    npc.abilityIntent.targetId = player.id;
    npc.abilityIntent.requestedAtMs = 500;

    const spy = vi.spyOn(zone.abilityEngine, "handleAbilityUse");

    const system = new AbilityIntentSystem();
    system.update(zone, 1000, 5);

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call?.actor).toBe(npc);
    expect(call?.request.abilityId).toBe("fireball");
    expect(call?.request.target.targetEntityId).toBe(player.id);
    expect(npc.abilityIntent.abilityId).toBeUndefined();
    expect(npc.abilityIntent.targetId).toBeUndefined();
    expect(npc.abilityIntent.targetPosition).toBeUndefined();

    spy.mockRestore();
  });

  it("interrupts casts when NPC movement is attempted", () => {
    npc.activeCast = {
      castId: 1,
      actorId: npc.id,
      abilityId: "fireball",
      requestId: "req-1",
      sequence: 1,
      serverTick: 1,
      castStartTimeMs: 0,
      castEndTimeMs: 5000,
      result: {
        abilityId: "fireball",
        actorId: npc.id,
        useCheck: { roll: 10, maxRoll: 100, result: "success" },
        effects: [],
      },
    };
    npc.synced.abilityState.castStartTimeMs = 0;
    npc.synced.abilityState.castEndTimeMs = 5000;
    npc.synced.abilityState.castAbilityId = "fireball";
    npc.synced.abilityState.castId = 1;
    expect(npc.activeCast).toBeDefined();

    npc.steeringIntent.directionX = 1;
    npc.steeringIntent.directionZ = 0;
    npc.steeringIntent.facingYaw = 0;

    zone.movementController.fixedTick(
      1000,
      50,
      2,
      zone.zoneData.navmeshQuery,
      zone.zoneData.collisionWorld,
    );

    expect(npc.activeCast).toBeUndefined();
  });
});
