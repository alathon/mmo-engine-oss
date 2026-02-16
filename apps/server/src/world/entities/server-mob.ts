import type { AbilityDefinition, AbilityUseRejectionReason, MobState } from "@mmo/shared";
import { StatsController } from "../../combat/stats-controller";
import { StatusController } from "../../combat/status-controller";
import { STATUS_DEFINITIONS } from "../../combat/status-definitions";
import type { ActiveCast, BufferedAbilityRequest } from "../../combat/types";

/**
 * Server-only base class for any combat-capable mob entity.
 */
export abstract class ServerMob<TState extends MobState> {
  constructor(public synced: TState) {
    this.statusController = new StatusController(this.synced, STATUS_DEFINITIONS, () => {
      this.statsController?.markDirty();
      this.statsController?.getDerivedStats();
    });
    this.statsController = new StatsController(this.synced, [this.statusController]);
  }

  // Movement/runtime state shared across players/NPCs.
  dirX = 0;
  dirZ = 0;
  navmeshNodeRef?: number;

  // Combat runtime state (server-authoritative only).
  cooldowns = new Map<string, number>();
  activeCast?: ActiveCast;
  bufferedRequest?: BufferedAbilityRequest;
  statusController?: StatusController;
  statsController?: StatsController;

  canUseAbility(
    ability: AbilityDefinition,
  ): { canUse: true } | { canUse: false; reason: AbilityUseRejectionReason } {
    const statusController = this.statusController;
    if (!statusController) {
      return { canUse: true };
    }
    if (statusController.hasStateFlag("stunned")) {
      return { canUse: false, reason: "stunned" };
    }
    const abilityTags = ability.abilityTags ?? [];
    if (abilityTags.length === 0) {
      return { canUse: true };
    }

    if (statusController.hasStateFlag("silenced") && abilityTags.includes("spell")) {
      return { canUse: false, reason: "silenced" };
    }

    if (
      statusController.hasStateFlag("disarmed") &&
      (abilityTags.includes("melee") || abilityTags.includes("ranged"))
    ) {
      return { canUse: false, reason: "disarmed" };
    }

    if (statusController.hasStateFlag("rooted") && abilityTags.includes("movement")) {
      return { canUse: false, reason: "rooted" };
    }

    const blockedTags = statusController.getBlockedAbilityTags();
    for (const tag of abilityTags) {
      if (!blockedTags.has(tag)) {
        continue;
      }
      if (tag === "spell") {
        return { canUse: false, reason: "silenced" };
      }
      if (tag === "melee" || tag === "ranged") {
        return { canUse: false, reason: "disarmed" };
      }
      if (tag === "movement") {
        return { canUse: false, reason: "rooted" };
      }
      return { canUse: false, reason: "illegal" };
    }
    return { canUse: true };
  }

  get id(): string {
    return this.synced.id;
  }
}
