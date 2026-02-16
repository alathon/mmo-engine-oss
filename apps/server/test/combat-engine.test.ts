/* eslint-disable @typescript-eslint/no-dynamic-delete */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ABILITY_DEFINITIONS,
  GCD_SECONDS,
  INTERNAL_COOLDOWN_MS,
  type AbilityAck,
  type AbilityCancelRequest,
  type AbilityDefinition,
  type AbilityResult,
  type AbilityUseRequest,
  type StatusEffectDefinition,
  NPCState,
  PlayerState,
  ZoneState,
} from "@mmo/shared";
import { AbilityEngine } from "../src/combat/ability-engine";
import { STATUS_DEFINITIONS } from "../src/combat/status-definitions";
import { ServerPlayer } from "../src/world/entities/player";
import { ServerNPC } from "../src/world/entities/npc";
import { ServerZone, ZoneData } from "../src/world/zones/zone";
import { createTestNavmeshQuery } from "./test-navmesh";
import { createTestCollisionWorld } from "./test-collision-world";

const TEST_NAVMESH_BASE_X = -52;
const TEST_NAVMESH_BASE_Y = 8;
const TEST_NAVMESH_BASE_Z = 24;

const createZone = (): ServerZone => {
  const definition = {
    id: "combat-test-zone",
    name: "Combat Test Zone",
    sceneData: {
      glbFilePath: "test.glb",
      terrainObjects: [],
      navmeshFilePath: "test.navmesh",
    },
  };
  const zoneData = new ZoneData(
    "combat-test-zone",
    createTestNavmeshQuery(),
    definition,
    createTestCollisionWorld("combat-test-zone"),
  );

  return new ServerZone(zoneData, new ZoneState());
};

const createPlayer = (zone: ServerZone, id: string, x = 0, z = 0): ServerPlayer => {
  const state = new PlayerState();
  state.id = id;
  state.playerId = id;
  state.x = TEST_NAVMESH_BASE_X + x;
  state.y = TEST_NAVMESH_BASE_Y;
  state.z = TEST_NAVMESH_BASE_Z + z;
  state.name = id;
  state.factionId = "players";
  const player = new ServerPlayer(state);
  zone.players.set(id, player);
  return player;
};

const createNpc = (zone: ServerZone, id: string, x = 0, z = 0): ServerNPC => {
  const state = new NPCState();
  state.id = id;
  state.x = TEST_NAVMESH_BASE_X + x;
  state.y = TEST_NAVMESH_BASE_Y;
  state.z = TEST_NAVMESH_BASE_Z + z;
  state.name = id;
  state.factionId = "npcs";
  const npc = new ServerNPC(state);
  zone.npcs.set(id, npc);
  return npc;
};

describe("AbilityEngine", () => {
  let zone: ServerZone;
  let engine: AbilityEngine;

  beforeEach(() => {
    zone = createZone();
    engine = zone.abilityEngine;
  });

  it("accepts ability use and sets combat timers", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-1",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 5,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    const ack = acks[0];
    expect(ack.accepted).toBe(true);
    expect(ack.castStartTimeMs).toBe(1000);
    expect(ack.castEndTimeMs).toBe(1000);
    expect(ack.gcdStartTimeMs).toBe(1000);
    expect(ack.gcdEndTimeMs).toBe(1000 + GCD_SECONDS * 1000);
    expect(ack.result?.abilityId).toBe("shield_bash");
    expect(ack.result?.effects[0]?.targets).toHaveLength(1);

    const abilityState = player.synced.abilityState;
    expect(abilityState.castAbilityId).toBe("shield_bash");
    expect(abilityState.gcdEndTimeMs).toBe(1000 + GCD_SECONDS * 1000);
    expect(abilityState.internalCooldownEndTimeMs).toBe(1000 + INTERNAL_COOLDOWN_MS);

    engine.fixedTick(1000, 6);

    expect(player.cooldowns.get("shield_bash")).toBe(
      1000 + ABILITY_DEFINITIONS.shield_bash.cooldownMs,
    );
  });

  it("resolves circle AOE targets around the target entity", () => {
    const player = createPlayer(zone, "player-1", 0, 0);
    player.synced.facingYaw = 0;
    createNpc(zone, "npc-1", 3, 0);
    createNpc(zone, "npc-2", 5, 0);
    createNpc(zone, "npc-3", 10, 0);

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-circle",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "fireball",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];

    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    const targets = acks[0]?.result?.effects[0]?.targets?.map((t) => t.targetId).toSorted() ?? [];
    expect(targets).toEqual(["npc-1", "npc-2"]);
  });

  it("resolves cone AOE targets from actor facing", () => {
    const player = createPlayer(zone, "player-1", 0, 0);
    player.synced.facingYaw = 0;
    createNpc(zone, "npc-1", 0, 5);
    createNpc(zone, "npc-2", 2, 5);
    createNpc(zone, "npc-3", 5, 0);

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cone",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "sky_sword",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];

    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    const targets = acks[0]?.result?.effects[0]?.targets?.map((t) => t.targetId).toSorted() ?? [];
    expect(targets).toEqual(["npc-1", "npc-2"]);
  });

  it("returns per-effect targets for status-only abilities", () => {
    const player = createPlayer(zone, "player-1", 0, 0);
    createNpc(zone, "npc-1", 1, 0);

    const abilityMap = ABILITY_DEFINITIONS as Record<string, AbilityDefinition>;
    const abilityId = "test_status_only";
    abilityMap[abilityId] = {
      id: abilityId,
      name: "Test Status Only",
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 6,
      targetType: "enemy",
      aoeShape: "single",
      effects: [
        {
          type: "status",
          statusId: "stunned",
          durationMs: 1000,
          targetFilter: "enemies",
        },
      ],
    };

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-status-only",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId,
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];

    try {
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });

      const effect = acks[0]?.result?.effects[0];
      expect(effect?.effectType).toBe("status");
      expect(effect?.targets).toHaveLength(1);
      expect(effect?.targets[0].targetId).toBe("npc-1");
      expect(effect?.targets[0].outcome).toBe("hit");
      expect(effect?.targets[0].statusApplied).toEqual(["stunned"]);
    } finally {
      delete abilityMap[abilityId];
    }
  });

  it("marks no_effect when the use check fails", () => {
    const player = createPlayer(zone, "player-1", 0, 0);
    createNpc(zone, "npc-1", 1, 0);

    const ability = ABILITY_DEFINITIONS.shield_bash as AbilityDefinition;
    const originalRoll = ability.rollUseCheck;
    ability.rollUseCheck = () => ({
      roll: 1,
      maxRoll: 100,
      result: "failure",
    });

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-use-fail",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];

    try {
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });

      const result = acks[0]?.result;
      expect(result?.useCheck.result).toBe("failure");
      const effectResults = result?.effects ?? [];
      for (const effect of effectResults) {
        expect(effect.targets).toHaveLength(1);
        expect(effect.targets[0].outcome).toBe("no_effect");
        expect(effect.targets[0].damage).toBeUndefined();
        expect(effect.targets[0].healing).toBeUndefined();
        expect(effect.targets[0].statusApplied).toBeUndefined();
      }
    } finally {
      ability.rollUseCheck = originalRoll;
    }
  });

  it("manages ability event listeners without duplicates", () => {
    const player = createPlayer(zone, "player-1", 0, 0);
    createNpc(zone, "npc-1", 1, 0);

    const abilityMap = ABILITY_DEFINITIONS as Record<string, AbilityDefinition>;
    const abilityId = "test_event_ability";
    abilityMap[abilityId] = {
      id: abilityId,
      name: "Test Event Ability",
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 6,
      targetType: "enemy",
      aoeShape: "single",
      effects: [{ type: "damage", school: "physical", targetFilter: "enemies" }],
    };

    const listener = { onAbilityEvent: vi.fn() };

    try {
      engine.addEventListener(listener);
      engine.addEventListener(listener);

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-event-1",
        sequence: 1,
        clientTick: 1,
        actorId: "player-1",
        abilityId,
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: () => {},
      });
      engine.fixedTick(1000, 2);

      expect(listener.onAbilityEvent).toHaveBeenCalledTimes(1);

      engine.removeEventListener(listener);

      engine.handleAbilityUse({
        request: { ...request, requestId: "req-event-2", sequence: 2 },
        actor: player,
        serverTimeMs: 2000,
        serverTick: 3,
        sendAck: () => {},
      });
      engine.fixedTick(2000, 4);

      expect(listener.onAbilityEvent).toHaveBeenCalledTimes(1);

      engine.addEventListener(listener);
      engine.clearEventListeners();

      engine.handleAbilityUse({
        request: { ...request, requestId: "req-event-3", sequence: 3 },
        actor: player,
        serverTimeMs: 3000,
        serverTick: 5,
        sendAck: () => {},
      });
      engine.fixedTick(3000, 6);

      expect(listener.onAbilityEvent).toHaveBeenCalledTimes(1);
    } finally {
      delete abilityMap[abilityId];
    }
  });

  it("buffers abilities during the window and rejects early/overfill", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const castRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cast",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "fireball",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequestEarly: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-early",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequestLate: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-late",
      sequence: 3,
      clientTick: 3,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequestOverflow: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-overflow",
      sequence: 4,
      clientTick: 4,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];

    engine.handleAbilityUse({
      request: castRequest,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    engine.handleAbilityUse({
      request: bufferRequestEarly,
      actor: player,
      serverTimeMs: 1200,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(2);
    expect(acks[1].accepted).toBe(false);
    expect(acks[1].rejectReason).toBe("buffer_window_closed");

    engine.handleAbilityUse({
      request: bufferRequestLate,
      actor: player,
      serverTimeMs: 2000,
      serverTick: 3,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(2);

    engine.handleAbilityUse({
      request: bufferRequestOverflow,
      actor: player,
      serverTimeMs: 2100,
      serverTick: 4,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(3);
    expect(acks[2].rejectReason).toBe("buffer_full");

    engine.fixedTick(6000, 10);

    expect(acks).toHaveLength(4);
    expect(acks[3].accepted).toBe(true);
    expect(acks[3].result?.abilityId).toBe("shield_bash");
  });

  it("handles a buffered timeline sequence across multiple casts", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const abilityMap = ABILITY_DEFINITIONS as Record<string, AbilityDefinition>;
    const longCastId = "test_long_cast";
    abilityMap[longCastId] = {
      id: longCastId,
      name: "Test Long Cast",
      isOnGcd: true,
      castTimeMs: 3000,
      cooldownMs: 0,
      range: 10,
      targetType: "enemy",
      aoeShape: "single",
      effects: [],
    };

    const acks: AbilityAck[] = [];

    try {
      const startLongCast: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-long-1",
        sequence: 1,
        clientTick: 1,
        actorId: "player-1",
        abilityId: longCastId,
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      engine.handleAbilityUse({
        request: startLongCast,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });

      expect(acks).toHaveLength(1);
      expect(acks[0].accepted).toBe(true);
      expect(acks[0].castEndTimeMs).toBe(4000);
      expect(acks[0].gcdStartTimeMs).toBe(1000);
      expect(acks[0].gcdEndTimeMs).toBe(3500);

      const bufferShieldBash: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-buffer-shield",
        sequence: 2,
        clientTick: 2,
        actorId: "player-1",
        abilityId: "shield_bash",
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      engine.handleAbilityUse({
        request: bufferShieldBash,
        actor: player,
        serverTimeMs: 1800,
        serverTick: 2,
        sendAck: (ack) => acks.push(ack),
      });

      expect(acks).toHaveLength(1);
      expect(player.bufferedRequest?.request.requestId).toBe("req-buffer-shield");

      engine.fixedTick(4000, 3);
      engine.fixedTick(4100, 4);

      expect(acks).toHaveLength(2);
      expect(acks[1].accepted).toBe(true);
      expect(acks[1].result?.abilityId).toBe("shield_bash");

      const bufferLongCast: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-long-2",
        sequence: 3,
        clientTick: 3,
        actorId: "player-1",
        abilityId: longCastId,
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      engine.handleAbilityUse({
        request: bufferLongCast,
        actor: player,
        serverTimeMs: 5250,
        serverTick: 5,
        sendAck: (ack) => acks.push(ack),
      });

      expect(acks).toHaveLength(2);
      expect(player.bufferedRequest?.request.requestId).toBe("req-long-2");

      engine.fixedTick(6500, 6);

      expect(acks).toHaveLength(3);
      expect(acks[2].accepted).toBe(true);
      expect(acks[2].castStartTimeMs).toBe(6500);
      expect(acks[2].gcdStartTimeMs).toBe(6500);
      expect(acks[2].gcdEndTimeMs).toBe(9000);
      expect(acks[2].result?.abilityId).toBe(longCastId);
    } finally {
      delete abilityMap[longCastId];
    }
  });

  it("rejects buffered abilities when cooldowns are not ready at request time", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    player.cooldowns.set("shield_bash", 5500);

    const castRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cast",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "fireball",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-buffer",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];

    engine.handleAbilityUse({
      request: castRequest,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    engine.handleAbilityUse({
      request: bufferRequest,
      actor: player,
      serverTimeMs: 5200,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(2);
    expect(acks[1].accepted).toBe(false);
    expect(acks[1].rejectReason).toBe("cooldown");
    expect(player.bufferedRequest).toBeUndefined();

    engine.fixedTick(6000, 10);

    expect(acks).toHaveLength(2);
  });

  it("orders stack resolution deterministically", () => {
    const playerA = createPlayer(zone, "player-a");
    const playerB = createPlayer(zone, "player-b");

    const requestA: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-a",
      sequence: 2,
      clientTick: 1,
      actorId: "player-a",
      abilityId: "shield_bash",
      target: { targetEntityId: "player-b" },
      clientTimeMs: 0,
    };

    const requestB: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-b",
      sequence: 1,
      clientTick: 1,
      actorId: "player-b",
      abilityId: "shield_bash",
      target: { targetEntityId: "player-a" },
      clientTimeMs: 0,
    };

    engine.handleAbilityUse({
      request: requestA,
      actor: playerA,
      serverTimeMs: 1000,
      serverTick: 2,
      sendAck: () => {},
    });

    engine.handleAbilityUse({
      request: requestB,
      actor: playerB,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: () => {},
    });

    const spy = vi.spyOn(engine, "applyResult");
    engine.fixedTick(1000, 5);

    expect(spy).toHaveBeenCalledTimes(2);
    const first = spy.mock.calls[0][0] as { requestId: string };
    const second = spy.mock.calls[1][0] as { requestId: string };
    expect(first.requestId).toBe("req-b");
    expect(second.requestId).toBe("req-a");
  });

  it("clears active cast and buffered request on cancel", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const castRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cast",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "fireball",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-buffer",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request: castRequest,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    engine.handleAbilityUse({
      request: bufferRequest,
      actor: player,
      serverTimeMs: 5200,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(player.bufferedRequest).toBeDefined();

    const cancel: AbilityCancelRequest = {
      type: "ability_cancel",
      requestId: "req-cancel",
      sequence: 3,
      clientTick: 3,
      actorId: "player-1",
      reason: "manual",
      clientTimeMs: 0,
    };

    engine.handleAbilityCancel({
      request: cancel,
      actor: player,
      serverTimeMs: 4500,
      serverTick: 3,
    });

    expect(player.activeCast).toBeUndefined();
    expect(player.bufferedRequest).toBeUndefined();
    expect(player.synced.abilityState.castStartTimeMs).toBe(0);
    expect(player.synced.abilityState.castEndTimeMs).toBe(0);
    expect(player.synced.abilityState.castAbilityId).toBe("");
  });

  it("rejects ability use when cooldown is active", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    player.cooldowns.set("quick_dart", 5000);

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cooldown",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "quick_dart",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(false);
    expect(acks[0].rejectReason).toBe("cooldown");
  });

  it("rejects ability use when internal cooldown is active", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    player.synced.abilityState.internalCooldownEndTimeMs = 3000;

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-internal-cooldown",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "quick_dart",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 2000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(false);
    expect(acks[0].rejectReason).toBe("cooldown");
  });

  it("buffers on-GCD abilities during GCD but allows oGCD", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    player.synced.abilityState.gcdEndTimeMs = 3000;

    const onGcdRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-gcd",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const oGcdRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-ogcd",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "quick_dart",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request: onGcdRequest,
      actor: player,
      serverTimeMs: 1500,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });
    engine.handleAbilityUse({
      request: oGcdRequest,
      actor: player,
      serverTimeMs: 1500,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(true);
    expect(player.bufferedRequest?.request.requestId).toBe("req-gcd");

    engine.fixedTick(3000, 3);

    expect(acks).toHaveLength(2);
    expect(acks[1].accepted).toBe(true);
    expect(acks[1].requestId).toBe("req-gcd");
  });

  it("rejects GCD buffering before buffer-open and allows at 300ms even with internal cooldown", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    player.synced.abilityState.gcdEndTimeMs = 3500;
    player.synced.abilityState.internalCooldownEndTimeMs = 1700;

    const earlyRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-gcd-early",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const openRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-gcd-open",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request: earlyRequest,
      actor: player,
      serverTimeMs: 1200,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(false);
    expect(acks[0].rejectReason).toBe("buffer_window_closed");

    engine.handleAbilityUse({
      request: openRequest,
      actor: player,
      serverTimeMs: 1300,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(player.bufferedRequest?.request.requestId).toBe("req-gcd-open");
  });

  it("rejects out-of-range targets", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 100, 0);

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-range",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(false);
    expect(acks[0].rejectReason).toBe("out_of_range");
  });

  it("rejects ability use when stunned", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const statusId = "test-stunned";
    const stunnedStatus: StatusEffectDefinition = {
      id: statusId,
      name: "Stunned",
      category: "debuff",
      durationMs: 5000,
      stacking: "replace",
      stateFlags: ["stunned"],
    };
    STATUS_DEFINITIONS[statusId] = stunnedStatus;

    try {
      expect(player.statusController).toBeDefined();
      player.statusController?.applyStatus(stunnedStatus, player.synced, 0);

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-stunned",
        sequence: 1,
        clientTick: 1,
        actorId: "player-1",
        abilityId: "shield_bash",
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      const acks: AbilityAck[] = [];
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });

      expect(acks).toHaveLength(1);
      expect(acks[0].accepted).toBe(false);
      expect(acks[0].rejectReason).toBe("stunned");
    } finally {
      delete STATUS_DEFINITIONS[statusId];
    }
  });

  it("rejects abilities blocked by status tags", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const statusId = "test-silence";
    const silenceStatus: StatusEffectDefinition = {
      id: statusId,
      name: "Silence",
      category: "debuff",
      durationMs: 5000,
      stacking: "replace",
      blockedAbilityTags: ["spell"],
    };
    STATUS_DEFINITIONS[statusId] = silenceStatus;

    const abilityMap = ABILITY_DEFINITIONS as Record<string, AbilityDefinition>;
    const abilityId = "test_spell";
    abilityMap[abilityId] = {
      id: abilityId,
      name: "Test Spell",
      abilityTags: ["spell"],
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 6,
      targetType: "enemy",
      aoeShape: "single",
      effects: [{ type: "damage", school: "arcane", targetFilter: "enemies" }],
    };

    try {
      expect(player.statusController).toBeDefined();
      player.statusController?.applyStatus(silenceStatus, player.synced, 0);

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-silenced",
        sequence: 1,
        clientTick: 1,
        actorId: "player-1",
        abilityId,
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      const acks: AbilityAck[] = [];
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });

      expect(acks).toHaveLength(1);
      expect(acks[0].accepted).toBe(false);
      expect(acks[0].rejectReason).toBe("silenced");
    } finally {
      delete STATUS_DEFINITIONS[statusId];
      delete abilityMap[abilityId];
    }
  });

  it("rejects melee abilities when disarmed", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const statusId = "test-disarm";
    const disarmStatus: StatusEffectDefinition = {
      id: statusId,
      name: "Disarm",
      category: "debuff",
      durationMs: 5000,
      stacking: "replace",
      stateFlags: ["disarmed"],
    };
    STATUS_DEFINITIONS[statusId] = disarmStatus;

    const abilityMap = ABILITY_DEFINITIONS as Record<string, AbilityDefinition>;
    const abilityId = "test_melee";
    abilityMap[abilityId] = {
      id: abilityId,
      name: "Test Melee",
      abilityTags: ["melee"],
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 6,
      targetType: "enemy",
      aoeShape: "single",
      effects: [{ type: "damage", school: "physical", targetFilter: "enemies" }],
    };

    try {
      expect(player.statusController).toBeDefined();
      player.statusController?.applyStatus(disarmStatus, player.synced, 0);

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-disarm",
        sequence: 1,
        clientTick: 1,
        actorId: "player-1",
        abilityId,
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      const acks: AbilityAck[] = [];
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });

      expect(acks).toHaveLength(1);
      expect(acks[0].accepted).toBe(false);
      expect(acks[0].rejectReason).toBe("disarmed");
    } finally {
      delete STATUS_DEFINITIONS[statusId];
      delete abilityMap[abilityId];
    }
  });

  it("rejects movement abilities when rooted", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const statusId = "test-rooted";
    const rootedStatus: StatusEffectDefinition = {
      id: statusId,
      name: "Rooted",
      category: "debuff",
      durationMs: 5000,
      stacking: "replace",
      stateFlags: ["rooted"],
    };
    STATUS_DEFINITIONS[statusId] = rootedStatus;

    const abilityMap = ABILITY_DEFINITIONS as Record<string, AbilityDefinition>;
    const abilityId = "test_movement";
    abilityMap[abilityId] = {
      id: abilityId,
      name: "Test Movement",
      abilityTags: ["movement"],
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 6,
      targetType: "enemy",
      aoeShape: "single",
      effects: [{ type: "damage", school: "physical", targetFilter: "enemies" }],
    };

    try {
      expect(player.statusController).toBeDefined();
      player.statusController?.applyStatus(rootedStatus, player.synced, 0);

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId: "req-rooted",
        sequence: 1,
        clientTick: 1,
        actorId: "player-1",
        abilityId,
        target: { targetEntityId: "npc-1" },
        clientTimeMs: 0,
      };

      const acks: AbilityAck[] = [];
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });

      expect(acks).toHaveLength(1);
      expect(acks[0].accepted).toBe(false);
      expect(acks[0].rejectReason).toBe("rooted");
    } finally {
      delete STATUS_DEFINITIONS[statusId];
      delete abilityMap[abilityId];
    }
  });

  it("rejects missing target entity for enemy abilities", () => {
    const player = createPlayer(zone, "player-1");

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-missing-target",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: {},
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(false);
    expect(acks[0].rejectReason).toBe("illegal");
  });

  it("rejects missing target point for ground abilities", () => {
    const player = createPlayer(zone, "player-1");

    const abilityMap = ABILITY_DEFINITIONS as Record<string, AbilityDefinition>;
    const groundAbilityId = "test_ground";
    abilityMap[groundAbilityId] = {
      id: groundAbilityId,
      name: "Test Ground",
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 10,
      targetType: "ground",
      aoeShape: "single",
      effects: [],
    };

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-ground",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: groundAbilityId,
      target: {},
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    try {
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: 1000,
        serverTick: 1,
        sendAck: (ack) => acks.push(ack),
      });
    } finally {
      delete abilityMap[groundAbilityId];
    }

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(false);
    expect(acks[0].rejectReason).toBe("illegal");
  });

  it("buffers abilities at the buffer window open boundary", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const castRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cast",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "fireball",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-buffer",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request: castRequest,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    engine.handleAbilityUse({
      request: bufferRequest,
      actor: player,
      serverTimeMs: 1300,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(player.bufferedRequest).toBeDefined();
  });

  it("buffers abilities at the cast end boundary", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const castRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cast",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "fireball",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-buffer",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request: castRequest,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    engine.handleAbilityUse({
      request: bufferRequest,
      actor: player,
      serverTimeMs: 6000,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(player.bufferedRequest).toBeDefined();
  });

  it("buffers after cast end when gcd is still active and cast cleanup is pending", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const castRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-cast",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "sky_sword",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const bufferRequest: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-buffer",
      sequence: 2,
      clientTick: 2,
      actorId: "player-1",
      abilityId: "shield_bash",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request: castRequest,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    engine.handleAbilityUse({
      request: bufferRequest,
      actor: player,
      serverTimeMs: 2600,
      serverTick: 2,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(player.bufferedRequest).toBeDefined();
  });

  it("omits GCD fields in ACKs for oGCD abilities", () => {
    const player = createPlayer(zone, "player-1");
    createNpc(zone, "npc-1", 1, 0);

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId: "req-ogcd",
      sequence: 1,
      clientTick: 1,
      actorId: "player-1",
      abilityId: "quick_dart",
      target: { targetEntityId: "npc-1" },
      clientTimeMs: 0,
    };

    const acks: AbilityAck[] = [];
    engine.handleAbilityUse({
      request,
      actor: player,
      serverTimeMs: 1000,
      serverTick: 1,
      sendAck: (ack) => acks.push(ack),
    });

    expect(acks).toHaveLength(1);
    expect(acks[0].accepted).toBe(true);
    expect(acks[0].gcdStartTimeMs).toBeUndefined();
    expect(acks[0].gcdEndTimeMs).toBeUndefined();
  });
});

describe("CombatEngine aggro", () => {
  it("adds aggro to NPCs when they take damage", () => {
    const zone = createZone();
    const player = createPlayer(zone, "player-1");
    const npc = createNpc(zone, "npc-1");

    const ability: AbilityDefinition = {
      id: "test_damage",
      name: "Test Damage",
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 6,
      targetType: "enemy",
      aoeShape: "single",
      effects: [{ type: "damage", school: "physical", targetFilter: "enemies" }],
    };

    const result: AbilityResult = {
      abilityId: ability.id,
      actorId: player.id,
      useCheck: { roll: 100, maxRoll: 100, result: "success" },
      effects: [
        {
          effectIndex: 0,
          effectType: "damage",
          targets: [
            {
              targetId: npc.id,
              outcome: "hit",
              damage: 10,
            },
          ],
        },
      ],
    };

    zone.combatEngine.onAbilityEvent({
      type: "ability_resolved",
      ability,
      actor: player,
      result,
      resolvedAtMs: 1000,
    });

    expect(npc.aggro.getAggro(player.id)).toBe(20);
    expect(npc.synced.combatState.aggro.get(player.id)?.percent).toBe(100);
  });

  it("adds aggro to NPCs in combat with a healed ally", () => {
    const zone = createZone();
    const healer = createPlayer(zone, "healer");
    const ally = createPlayer(zone, "ally");
    const npc = createNpc(zone, "npc-1");

    npc.synced.inCombat = true;
    npc.aggro.setAggro(ally.id, 10);

    const ability: AbilityDefinition = {
      id: "test_heal",
      name: "Test Heal",
      isOnGcd: false,
      castTimeMs: 0,
      cooldownMs: 0,
      range: 6,
      targetType: "ally",
      aoeShape: "single",
      effects: [{ type: "healing", targetFilter: "allies" }],
    };

    const result: AbilityResult = {
      abilityId: ability.id,
      actorId: healer.id,
      useCheck: { roll: 100, maxRoll: 100, result: "success" },
      effects: [
        {
          effectIndex: 0,
          effectType: "healing",
          targets: [
            {
              targetId: ally.id,
              outcome: "hit",
              healing: 15,
            },
          ],
        },
      ],
    };

    zone.combatEngine.onAbilityEvent({
      type: "ability_resolved",
      ability,
      actor: healer,
      result,
      resolvedAtMs: 2000,
    });

    expect(npc.aggro.getAggro(healer.id)).toBe(7.5);
    expect(npc.synced.combatState.aggro.get(healer.id)?.percent).toBe(75);
    expect(npc.synced.combatState.aggro.get(ally.id)?.percent).toBe(100);
  });
});

describe("CombatEngine combat state", () => {
  it("clears combat when no NPC has the player on its aggro list", () => {
    const zone = createZone();
    const player = createPlayer(zone, "player-1");
    const npc = createNpc(zone, "npc-1");

    player.synced.inCombat = true;
    npc.synced.inCombat = true;
    npc.aggro.setAggro(player.id, 10);

    zone.combatEngine.fixedTick(1000);

    expect(player.synced.inCombat).toBe(true);
    expect(npc.synced.inCombat).toBe(true);

    npc.aggro.clear();
    zone.combatEngine.fixedTick(2000);

    expect(player.synced.inCombat).toBe(false);
    expect(npc.synced.inCombat).toBe(false);
  });

  it("drops NPC combat when all aggro targets are missing", () => {
    const zone = createZone();
    const npc = createNpc(zone, "npc-1");

    npc.synced.inCombat = true;
    npc.aggro.setAggro("missing-player", 10);

    zone.combatEngine.fixedTick(1000);

    expect(npc.synced.inCombat).toBe(false);
    expect(npc.synced.combatState.aggro.size).toBe(0);
  });

  it("keeps players in combat while any NPC has them on aggro", () => {
    const zone = createZone();
    const player = createPlayer(zone, "player-1");
    const npcA = createNpc(zone, "npc-a");
    const npcB = createNpc(zone, "npc-b");

    player.synced.inCombat = true;
    npcA.synced.inCombat = true;
    npcB.synced.inCombat = true;
    npcA.aggro.setAggro(player.id, 10);
    npcB.aggro.setAggro(player.id, 5);

    zone.combatEngine.fixedTick(1000);

    expect(player.synced.inCombat).toBe(true);

    npcA.aggro.clear();
    zone.combatEngine.fixedTick(2000);

    expect(player.synced.inCombat).toBe(true);

    npcB.aggro.clear();
    zone.combatEngine.fixedTick(3000);

    expect(player.synced.inCombat).toBe(false);
  });
});
