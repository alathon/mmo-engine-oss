import type { MobState } from "@mmo/shared";
import type { ServerMob } from "../../world/entities/server-mob";
import type { ServerZone } from "../../world/zones/zone";

export class AiTargetSelectionSystem {
  update(zone: ServerZone, combatants: Iterable<ServerMob<MobState>>): void {
    for (const npc of zone.npcs.values()) {
      const awareness = npc.combatAwareness;
      const selection = npc.targetSelection;

      if (!awareness.inCombat || !awareness.topAggroTargetId) {
        selection.targetId = undefined;
        selection.targetX = 0;
        selection.targetZ = 0;
        selection.targetYaw = 0;
        continue;
      }

      const target = this.resolveCombatant(awareness.topAggroTargetId, combatants);
      if (!target) {
        selection.targetId = undefined;
        selection.targetX = 0;
        selection.targetZ = 0;
        selection.targetYaw = 0;
        continue;
      }

      selection.targetId = target.id;
      selection.targetX = target.synced.x;
      selection.targetZ = target.synced.z;
      const dx = target.synced.x - npc.synced.x;
      const dz = target.synced.z - npc.synced.z;
      selection.targetYaw = Math.atan2(dx, dz);
    }
  }

  private resolveCombatant(
    targetId: string,
    combatants: Iterable<ServerMob<MobState>>,
  ): ServerMob<MobState> | undefined {
    for (const combatant of combatants) {
      if (combatant.id === targetId) {
        return combatant;
      }
    }
    return undefined;
  }
}
