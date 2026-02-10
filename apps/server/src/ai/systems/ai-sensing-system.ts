import type { ServerZone } from "../../world/zones/zone";

export class AiSensingSystem {
  update(zone: ServerZone): void {
    for (const npc of zone.npcs.values()) {
      const awareness = npc.combatAwareness;
      awareness.inCombat = npc.synced.inCombat;
      awareness.topAggroTargetId = npc.aggro.getTopTargetId() ?? undefined;
    }
  }
}
