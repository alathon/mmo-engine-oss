import { describe, expect, it, vi } from "vitest";
import {
  ABILITY_DEFINITIONS,
  type AbilityAck,
  type AbilityDefinition,
  type AbilityUseRequest,
  AbilityState,
  NPCState,
  PlayerState,
} from "@mmo/shared";
import { CombatController } from "./combatController";
import { ZoneConnectionManager } from "../network/zoneConnectionManager";
import { AbilityEngine } from "../../../server/src/combat/abilityEngine";
import { CombatEngine } from "../../../server/src/combat/combatEngine";
import { ServerPlayer } from "../../../server/src/world/entities/player";
import { ServerNPC } from "../../../server/src/world/entities/npc";
import type { ServerZone } from "../../../server/src/world/zones/zone";
import type { MobEntity } from "../entities/mobEntity";

describe("Combat integration", () => {
  it("bridges client requests through the server timeline", () => {
    vi.useFakeTimers();

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

    let nowMs = 1000;
    let serverTick = 1;
    vi.setSystemTime(nowMs);

    const zone = {
      players: new Map<string, ServerPlayer>(),
      npcs: new Map<string, ServerNPC>(),
      zoneData: {
        navmeshQuery: undefined,
        zoneId: "test-zone",
      },
      eventLog: {
        append: () => 0,
      },
      getServerTick: () => serverTick,
    } as unknown as ServerZone;
    const combatEngine = new CombatEngine(zone);
    const engine = new AbilityEngine(zone);
    engine.addEventListener(combatEngine);

    const playerState = new PlayerState();
    playerState.id = "player-1";
    playerState.playerId = "player-1";
    playerState.name = "player-1";
    playerState.x = 0;
    playerState.z = 0;
    const player = new ServerPlayer(playerState);
    zone.players.set(player.id, player);

    const npcState = new NPCState();
    npcState.id = "npc-1";
    npcState.name = "npc-1";
    npcState.x = 1;
    npcState.z = 0;
    const npc = new ServerNPC(npcState);
    zone.npcs.set(npc.id, npc);

    const clientSource = {
      getId: () => "player-1",
      getPosition: () => ({ x: 0, y: 0, z: 0 }),
      sync: {
        abilityState: new AbilityState({
          castStartTimeMs: 0,
          castEndTimeMs: 0,
          castAbilityId: "",
        }),
      },
    } as unknown as MobEntity;

    const syncAbilityState = (): void => {
      const serverAbility = player.synced.abilityState;
      const clientAbility = clientSource.sync.abilityState as {
        castStartTimeMs: number;
        castEndTimeMs: number;
        castAbilityId: string;
      };
      clientAbility.castStartTimeMs = serverAbility.castStartTimeMs;
      clientAbility.castEndTimeMs = serverAbility.castEndTimeMs;
      clientAbility.castAbilityId = serverAbility.castAbilityId;
    };

    const acks: AbilityAck[] = [];
    const zoneNetwork = new ZoneConnectionManager();
    const controller = new CombatController(clientSource, zoneNetwork);

    (
      zoneNetwork as unknown as {
        sendAbilityUse: (request: AbilityUseRequest) => void;
      }
    ).sendAbilityUse = (request: AbilityUseRequest) => {
      engine.handleAbilityUse({
        request,
        actor: player,
        serverTimeMs: nowMs,
        serverTick,
        sendAck: (ack) => {
          acks.push(ack);
          controller.applyAck(ack);
          syncAbilityState();
        },
      });
    };

    (
      zoneNetwork as unknown as {
        sendAbilityCancel: (request: unknown) => void;
      }
    ).sendAbilityCancel = () => {};

    try {
      controller.fixedTick();
      controller.tryUseAbility(longCastId, { targetEntityId: "npc-1" });

      expect(acks).toHaveLength(1);
      expect(acks[0].result?.abilityId).toBe(longCastId);
      syncAbilityState();

      nowMs = 1800;
      serverTick = 2;
      vi.setSystemTime(nowMs);
      controller.fixedTick();
      controller.tryUseAbility("shield_bash", { targetEntityId: "npc-1" });

      expect(acks).toHaveLength(1);
      expect(player.bufferedRequest?.request.abilityId).toBe("shield_bash");

      nowMs = 4000;
      serverTick = 3;
      vi.setSystemTime(nowMs);
      engine.fixedTick(nowMs, serverTick);
      syncAbilityState();

      expect(acks).toHaveLength(2);
      expect(acks[1].result?.abilityId).toBe("shield_bash");

      nowMs = 4100;
      serverTick = 4;
      vi.setSystemTime(nowMs);
      engine.fixedTick(nowMs, serverTick);
      syncAbilityState();

      nowMs = 5250;
      serverTick = 5;
      vi.setSystemTime(nowMs);
      controller.fixedTick();
      controller.tryUseAbility(longCastId, { targetEntityId: "npc-1" });

      expect(acks).toHaveLength(2);
      expect(player.bufferedRequest?.request.abilityId).toBe(longCastId);

      nowMs = 6500;
      serverTick = 6;
      vi.setSystemTime(nowMs);
      engine.fixedTick(nowMs, serverTick);
      syncAbilityState();

      expect(acks).toHaveLength(3);
      expect(acks[2].result?.abilityId).toBe(longCastId);
      expect(acks[2].castStartTimeMs).toBe(6500);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete abilityMap[longCastId];
      vi.useRealTimers();
    }
  });
});
