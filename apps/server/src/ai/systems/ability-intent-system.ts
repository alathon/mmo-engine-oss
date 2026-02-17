import type { AbilityUseRequest } from "@mmo/shared-sim";
import type { ServerZone } from "../../world/zones/zone";

export class AbilityIntentSystem {
  update(zone: ServerZone, serverTimeMs: number, serverTick: number): void {
    for (const npc of zone.npcs.values()) {
      const intent = npc.abilityIntent;
      if (!intent.abilityId) {
        continue;
      }

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId: `server-ai-${npc.id}-${serverTick}`,
        sequence: 0,
        clientTick: serverTick,
        actorId: npc.id,
        abilityId: intent.abilityId,
        target: {
          targetEntityId: intent.targetId ?? undefined,
          targetPoint: intent.targetPosition ?? undefined,
        },
        clientTimeMs: serverTimeMs,
      };

      zone.abilityEngine.handleAbilityUse({
        request,
        actor: npc,
        serverTimeMs,
        serverTick,
        sendAck: () => {},
      });

      intent.abilityId = undefined;
      intent.targetId = undefined;
      intent.targetPosition = undefined;
      intent.requestedAtMs = 0;
    }
  }
}
