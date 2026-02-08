import {
  CombatEventType,
  EventCategory,
  areAllies,
  type MobEnterCombatEvent,
  type MobExitCombatEvent,
  type MobState,
  type TargetResult,
} from "@mmo/shared";
import type { ServerMob } from "../world/entities/serverMob";
import type { ServerZone } from "../world/zones/zone";
import type { AbilityEvent, AbilityEventListener } from "./abilityEvents";
import { ServerNPC } from "../world/entities/npc";
import { STATUS_DEFINITIONS } from "./statusDefinitions";

const STATUS_AGGRO_AMOUNT = 50;
const DAMAGE_AGGRO_MULTIPLIER = 2;
const HEALING_AGGRO_MULTIPLIER = 0.5;

/**
 * Tracks whether entities are in combat based on hostile ability outcomes.
 * Consumes AbilityEngine events to mark combat and clears it when no aggro remains.
 */
export class CombatEngine implements AbilityEventListener {
  constructor(private readonly zone: ServerZone) {}

  /** Handle resolved ability events and mark combatants when hostile effects occur. */
  onAbilityEvent(event: AbilityEvent): void {
    if (event.type !== "ability_resolved") {
      return;
    }

    const useCheck = event.result.useCheck.result;
    const useSucceeded = useCheck === "success" || useCheck === "crit_success";
    if (!useSucceeded) {
      return;
    }

    for (const effectResult of event.result.effects) {
      const effect = event.ability.effects[effectResult.effectIndex];
      if (!effect || effect.type !== effectResult.effectType) {
        continue;
      }

      if (
        effect.targetFilter === "enemies" &&
        effectResult.targets.length > 0
      ) {
        const hostileTargets: ServerMob<MobState>[] = [];
        for (const targetResult of effectResult.targets) {
          const target = this.getCombatantById(targetResult.targetId);
          if (target) {
            hostileTargets.push(target);
          }
        }

        if (hostileTargets.length > 0) {
          this.recordHostileAction(
            event.actor,
            hostileTargets,
            event.resolvedAtMs,
          );
        }
      }

      if (effect.type === "damage") {
        this.applyDamageAggro(event.actor, effectResult.targets);
        continue;
      }

      if (effect.type === "healing") {
        this.applyHealingAggro(event.actor, effectResult.targets);
        continue;
      }

      this.applyStatusAggro(event.actor, effectResult.targets, effect.statusId);
    }
  }

  /** Mark the actor and targets as in combat and refresh their timers. */
  recordHostileAction(
    actor: ServerMob<MobState>,
    targets: Iterable<ServerMob<MobState>>,
    nowMs: number,
  ): void {
    this.markCombatantInCombat(actor, nowMs, "aggro");
    for (const target of targets) {
      this.markCombatantInCombat(target, nowMs, "damaged", actor.id);
    }
  }

  /** Clear combat state when no aggro relationships remain. */
  fixedTick(nowMs: number): void {
    const activeIds = this.collectActiveCombatantIds();
    for (const npc of this.zone.npcs.values()) {
      npc.aggro.hasAnyTargets(activeIds);
    }

    for (const combatant of this.iterateCombatants()) {
      if (!combatant.synced.inCombat) {
        continue;
      }
      if (!this.shouldRemainInCombat(combatant)) {
        combatant.synced.inCombat = false;
        const exitEvent: MobExitCombatEvent = {
          eventId: 0,
          category: EventCategory.Combat,
          eventType: CombatEventType.MobExitCombat,
          serverTick: this.zone.getServerTick(),
          serverTimeMs: nowMs,
          contextId: this.zone.zoneData.zoneId,
          mobId: combatant.id,
          reason: "timeout",
          sourceLocation: {
            x: combatant.synced.x,
            y: combatant.synced.y,
            z: combatant.synced.z,
          },
        };
        this.zone.eventLog.append(exitEvent);
        if (combatant instanceof ServerNPC) {
          combatant.aggro.clear();
        }
      }
    }
  }

  /** Set combat state and update the last hostile action timestamp. */
  private markCombatantInCombat(
    combatant: ServerMob<MobState>,
    nowMs: number,
    reason: MobEnterCombatEvent["reason"],
    instigatorId?: string,
  ): void {
    const abilityState = combatant.synced.abilityState;
    const wasInCombat = combatant.synced.inCombat;
    combatant.synced.inCombat = true;
    abilityState.lastHostileActionTimeMs = nowMs;
    if (!wasInCombat) {
      const enterEvent: MobEnterCombatEvent = {
        eventId: 0,
        category: EventCategory.Combat,
        eventType: CombatEventType.MobEnterCombat,
        serverTick: this.zone.getServerTick(),
        serverTimeMs: nowMs,
        contextId: this.zone.zoneData.zoneId,
        mobId: combatant.id,
        reason,
        instigatorId,
        sourceLocation: {
          x: combatant.synced.x,
          y: combatant.synced.y,
          z: combatant.synced.z,
        },
      };
      this.zone.eventLog.append(enterEvent);
    }
  }

  private shouldRemainInCombat(combatant: ServerMob<MobState>): boolean {
    if (combatant instanceof ServerNPC) {
      return combatant.aggro.hasAnyTargets();
    }
    return this.isAggroedByAnyNpc(combatant.id);
  }

  private isAggroedByAnyNpc(targetId: string): boolean {
    for (const npc of this.zone.npcs.values()) {
      if (npc.aggro.hasTarget(targetId)) {
        return true;
      }
    }
    return false;
  }

  private collectActiveCombatantIds(): Set<string> {
    const ids = new Set<string>();
    for (const player of this.zone.players.values()) {
      ids.add(player.id);
    }
    for (const npc of this.zone.npcs.values()) {
      ids.add(npc.id);
    }
    return ids;
  }

  private applyDamageAggro(
    actor: ServerMob<MobState>,
    targets: TargetResult[],
  ): void {
    for (const targetResult of targets) {
      const damage = targetResult.damage ?? 0;
      if (damage <= 0) {
        continue;
      }
      const target = this.getNpcById(targetResult.targetId);
      if (!target) {
        continue;
      }
      target.aggro.addAggro(actor.id, damage * DAMAGE_AGGRO_MULTIPLIER);
    }
  }

  private applyHealingAggro(
    actor: ServerMob<MobState>,
    targets: TargetResult[],
  ): void {
    for (const targetResult of targets) {
      const healing = targetResult.healing ?? 0;
      if (healing <= 0) {
        continue;
      }
      const target = this.getCombatantById(targetResult.targetId);
      if (!target) {
        continue;
      }
      if (!areAllies(actor.synced, target.synced)) {
        continue;
      }
      this.addAggroToEnemiesInCombatWith(
        target.id,
        actor.id,
        healing * HEALING_AGGRO_MULTIPLIER,
      );
    }
  }

  private applyStatusAggro(
    actor: ServerMob<MobState>,
    targets: TargetResult[],
    statusId: string,
  ): void {
    const definition = STATUS_DEFINITIONS[statusId];
    if (!definition) {
      return;
    }

    const isDebuff = definition.category === "debuff";
    const isBuff = definition.category === "buff";

    for (const targetResult of targets) {
      if (targetResult.outcome === "no_effect") {
        continue;
      }
      if (!targetResult.statusApplied?.includes(statusId)) {
        continue;
      }

      if (isDebuff) {
        const target = this.getNpcById(targetResult.targetId);
        if (!target) {
          continue;
        }
        target.aggro.addAggro(actor.id, STATUS_AGGRO_AMOUNT);
        continue;
      }

      if (isBuff) {
        const target = this.getCombatantById(targetResult.targetId);
        if (!target) {
          continue;
        }
        if (!areAllies(actor.synced, target.synced)) {
          continue;
        }
        this.addAggroToEnemiesInCombatWith(
          target.id,
          actor.id,
          STATUS_AGGRO_AMOUNT,
        );
      }
    }
  }

  private addAggroToEnemiesInCombatWith(
    allyId: string,
    sourceId: string,
    amount: number,
  ): void {
    if (amount <= 0) {
      return;
    }

    for (const npc of this.zone.npcs.values()) {
      if (!npc.synced.inCombat) {
        continue;
      }
      if (!npc.aggro.hasTarget(allyId)) {
        continue;
      }
      npc.aggro.addAggro(sourceId, amount);
    }
  }

  /** Iterate every server-side combatant in the zone. */
  private *iterateCombatants(): Iterable<ServerMob<MobState>> {
    for (const player of this.zone.players.values()) {
      yield player;
    }
    for (const npc of this.zone.npcs.values()) {
      yield npc;
    }
  }

  /** Resolve a combatant by id, checking players then NPCs. */
  private getCombatantById(id: string): ServerMob<MobState> | undefined {
    const player = this.zone.players.get(id);
    if (player) {
      return player;
    }
    return this.zone.npcs.get(id);
  }

  private getNpcById(id: string): ServerNPC | undefined {
    return this.zone.npcs.get(id);
  }
}
