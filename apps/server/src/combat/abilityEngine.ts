import {
  ABILITY_DEFINITIONS,
  AbilityAck,
  AbilityAckRejectReason,
  AbilityCancelRequest,
  AbilityUseRequest,
  AbilityUseRejectionReason,
  CombatEventType,
  EventCategory,
  INTERNAL_COOLDOWN_MS,
  GCD_SECONDS,
  canPayResourceCost,
  computeGcdEndTimeMs,
  canBufferAbility,
  hasLineOfSight,
  resolveTargetsForAbility,
  type AbilityCastFinishEvent,
  type AbilityCastInterruptEvent,
  type AbilityCastStartEvent,
  type AbilityEffectAppliedEvent,
  type MobState,
  type AbilityDefinition,
  type TargetSpec,
  type TargetCandidate,
  type TargetResult,
} from "@mmo/shared";
import { hashStringToUint32, resolveAbilityOutcome } from "@mmo/shared-servers";
import type { ServerZone } from "../world/zones/zone";
import type { ActiveCast } from "./types";
import type { ServerMob } from "../world/entities/serverMob";
import { applyDamage, applyHealing, applyResourceCost } from "./effects";
import { STATUS_DEFINITIONS } from "./statusDefinitions";
import type { AbilityEvent, AbilityEventListener } from "./abilityEvents";

const GCD_MS = GCD_SECONDS * 1000;

/** Context payload for handling an ability use request. */
export interface AbilityUseContext {
  request: AbilityUseRequest;
  actor: ServerMob<MobState>;
  serverTimeMs: number;
  serverTick: number;
  sendAck: (ack: AbilityAck) => void;
}

/** Context payload for handling an ability cancel request. */
export interface AbilityCancelContext {
  request: AbilityCancelRequest;
  actor: ServerMob<MobState>;
  serverTimeMs: number;
  serverTick: number;
}

/** Validation result when an ability use is rejected. */
interface ValidationFailure {
  accepted: false;
  rejectReason: AbilityUseRejectionReason;
}

/** Validation result when an ability use is accepted. */
interface ValidationSuccess {
  accepted: true;
  ability: AbilityDefinition;
  targetPosition?: { x: number; y: number; z: number };
  possibleTargetIds: string[];
}

type ValidationResult = ValidationFailure | ValidationSuccess;

/**
 * Server-side engine for validating, queuing, resolving, and applying abilities.
 * Owns cooldown/buffer logic and emits ability events when results are applied.
 */
export class AbilityEngine {
  private readonly listeners: AbilityEventListener[] = [];
  private nextCastId = 1;

  constructor(private readonly zone: ServerZone) {}

  /** Register an ability event listener; duplicate listeners are ignored. */
  addEventListener(listener: AbilityEventListener): void {
    if (this.listeners.includes(listener)) {
      return;
    }
    this.listeners.push(listener);
  }

  /** Remove a previously registered ability event listener. */
  removeEventListener(listener: AbilityEventListener): void {
    for (let i = this.listeners.length - 1; i >= 0; i -= 1) {
      if (this.listeners[i] === listener) {
        this.listeners.splice(i, 1);
      }
    }
  }

  /** Remove all ability event listeners. */
  clearEventListeners(): void {
    this.listeners.length = 0;
  }

  /**
   * Validate and queue an ability use request, sending an ack response.
   * Returns the ack immediately or null if the request was buffered.
   */
  handleAbilityUse(context: AbilityUseContext): AbilityAck | null {
    const { actor, request, serverTimeMs, serverTick, sendAck } = context;
    if (request.actorId !== actor.id) {
      const ack = this.buildRejectAck(
        request,
        serverTimeMs,
        serverTick,
        "illegal",
      );
      sendAck(ack);
      return ack;
    }

    const ability =
      ABILITY_DEFINITIONS[
        request.abilityId as keyof typeof ABILITY_DEFINITIONS
      ];
    if (!ability) {
      const ack = this.buildRejectAck(
        request,
        serverTimeMs,
        serverTick,
        "illegal",
      );
      sendAck(ack);
      return ack;
    }

    const abilityState = actor.synced.abilityState;

    if (actor.activeCast) {
      if (!ability.isOnGcd) {
        const ack = this.buildRejectAck(
          request,
          serverTimeMs,
          serverTick,
          "illegal",
        );
        sendAck(ack);
        return ack;
      }

      if (actor.bufferedRequest) {
        const ack = this.buildRejectAck(
          request,
          serverTimeMs,
          serverTick,
          "buffer_full",
        );
        sendAck(ack);
        return ack;
      }

      const canBuffer = canBufferAbility(
        serverTimeMs,
        actor.activeCast.castStartTimeMs,
        actor.activeCast.castEndTimeMs,
      );
      if (!canBuffer) {
        const ack = this.buildRejectAck(
          request,
          serverTimeMs,
          serverTick,
          "buffer_window_closed",
        );
        sendAck(ack);
        return ack;
      }

      const validation = this.validateAbilityUse(actor, request, serverTimeMs, {
        ignoreGcd: true,
      });
      if (!validation.accepted) {
        const ack = this.buildRejectAck(
          request,
          serverTimeMs,
          serverTick,
          validation.rejectReason,
        );
        sendAck(ack);
        return ack;
      }

      actor.bufferedRequest = {
        request,
        receivedAtMs: serverTimeMs,
        serverTick,
        sendAck,
      };
      return null;
    }

    if (
      ability.isOnGcd &&
      abilityState.gcdEndTimeMs > 0 &&
      !abilityState.isGcdReady(serverTimeMs)
    ) {
      if (actor.bufferedRequest) {
        const ack = this.buildRejectAck(
          request,
          serverTimeMs,
          serverTick,
          "buffer_full",
        );
        sendAck(ack);
        return ack;
      }

      const validation = this.validateAbilityUse(actor, request, serverTimeMs, {
        ignoreGcd: true,
      });
      if (!validation.accepted) {
        const ack = this.buildRejectAck(
          request,
          serverTimeMs,
          serverTick,
          validation.rejectReason,
        );
        sendAck(ack);
        return ack;
      }

      actor.bufferedRequest = {
        request,
        receivedAtMs: serverTimeMs,
        serverTick,
        sendAck,
      };
      return null;
    }

    const validation = this.validateAbilityUse(actor, request, serverTimeMs);
    if (!validation.accepted) {
      const ack = this.buildRejectAck(
        request,
        serverTimeMs,
        serverTick,
        validation.rejectReason,
      );
      sendAck(ack);
      return ack;
    }

    const ack = this.acceptIntoCastQueue(
      actor,
      request,
      validation,
      serverTimeMs,
      serverTick,
    );
    sendAck(ack);
    return ack;
  }

  /** Cancel the actor's active cast and buffered request, if any. */
  handleAbilityCancel(context: AbilityCancelContext): void {
    const { actor, request, serverTimeMs, serverTick } = context;
    if (request.actorId !== actor.id) {
      return;
    }

    const activeCast = actor.activeCast;
    const hadActiveCast = Boolean(activeCast);
    if (activeCast) {
      actor.activeCast = undefined;
    }
    if (actor.bufferedRequest) {
      actor.bufferedRequest = undefined;
    }

    const abilityState = actor.synced.abilityState;
    abilityState.castStartTimeMs = 0;
    abilityState.castEndTimeMs = 0;
    abilityState.castAbilityId = "";
    if (hadActiveCast) {
      abilityState.gcdEndTimeMs = 0;
      abilityState.internalCooldownEndTimeMs = 0;
      if (activeCast) {
        const interruptEvent: AbilityCastInterruptEvent = {
          eventId: 0,
          category: EventCategory.Combat,
          eventType: CombatEventType.AbilityCastInterrupt,
          serverTick,
          serverTimeMs,
          contextId: this.zone.zoneData.zoneId,
          actorId: activeCast.actorId,
          castId: activeCast.castId,
          abilityId: activeCast.abilityId,
          reason: this.mapInterruptReason(request.reason),
          sourceLocation: {
            x: actor.synced.x,
            y: actor.synced.y,
            z: actor.synced.z,
          },
        };
        this.zone.eventLog.append(interruptEvent);
      }
    }
  }

  /**
   * Advance cast queue state, resolve completed casts, and apply results.
   */
  fixedTick(serverTimeMs: number, serverTick: number): void {
    const stack: ActiveCast[] = [];

    for (const combatant of this.iterateCombatants()) {
      const activeCast = combatant.activeCast;
      if (activeCast) {
        if (activeCast.castEndTimeMs > serverTimeMs) {
          continue;
        }

        stack.push(activeCast);
        combatant.activeCast = undefined;
        const abilityState = combatant.synced.abilityState;
        abilityState.castStartTimeMs = 0;
        abilityState.castEndTimeMs = 0;
        abilityState.castAbilityId = "";
        const ability =
          ABILITY_DEFINITIONS[
            activeCast.abilityId as keyof typeof ABILITY_DEFINITIONS
          ];
        if (ability) {
          combatant.cooldowns.set(
            ability.id,
            activeCast.castEndTimeMs + ability.cooldownMs,
          );
        }

        if (combatant.bufferedRequest) {
          const buffered = combatant.bufferedRequest;
          const bufferedAbility =
            ABILITY_DEFINITIONS[
              buffered.request.abilityId as keyof typeof ABILITY_DEFINITIONS
            ];
          if (!bufferedAbility) {
            combatant.bufferedRequest = undefined;
            const ack = this.buildRejectAck(
              buffered.request,
              serverTimeMs,
              serverTick,
              "illegal",
            );
            buffered.sendAck(ack);
          } else if (!bufferedAbility.isOnGcd) {
            combatant.bufferedRequest = undefined;
            const ack = this.buildRejectAck(
              buffered.request,
              serverTimeMs,
              serverTick,
              "illegal",
            );
            buffered.sendAck(ack);
          } else if (
            bufferedAbility.isOnGcd &&
            !abilityState.isGcdReady(serverTimeMs)
          ) {
            continue;
          } else {
            combatant.bufferedRequest = undefined;
            const validation = this.validateAbilityUse(
              combatant,
              buffered.request,
              serverTimeMs,
            );
            if (validation.accepted) {
              const ack = this.acceptIntoCastQueue(
                combatant,
                buffered.request,
                validation,
                serverTimeMs,
                serverTick,
              );
              buffered.sendAck(ack);
            } else {
              const ack = this.buildRejectAck(
                buffered.request,
                serverTimeMs,
                serverTick,
                validation.rejectReason,
              );
              buffered.sendAck(ack);
            }
          }
        }
        continue;
      }

      if (
        combatant.bufferedRequest &&
        combatant.synced.abilityState.isGcdReady(serverTimeMs)
      ) {
        const buffered = combatant.bufferedRequest;
        combatant.bufferedRequest = undefined;
        const validation = this.validateAbilityUse(
          combatant,
          buffered.request,
          serverTimeMs,
        );
        if (validation.accepted) {
          const ack = this.acceptIntoCastQueue(
            combatant,
            buffered.request,
            validation,
            serverTimeMs,
            serverTick,
          );
          buffered.sendAck(ack);
        } else {
          const ack = this.buildRejectAck(
            buffered.request,
            serverTimeMs,
            serverTick,
            validation.rejectReason,
          );
          buffered.sendAck(ack);
        }
      }
    }

    const resolved = this.resolveStack(stack);
    for (const cast of resolved) {
      this.applyResult(cast, serverTick);
    }
  }

  /** Deterministic ordering for casts resolved in the same tick. */
  resolveStack(stack: ActiveCast[]): ActiveCast[] {
    return stack.sort((a, b) => {
      if (a.castEndTimeMs !== b.castEndTimeMs) {
        return a.castEndTimeMs - b.castEndTimeMs;
      }
      if (a.serverTick !== b.serverTick) {
        return a.serverTick - b.serverTick;
      }
      return a.sequence - b.sequence;
    });
  }

  /** Apply an ability result to entities and emit the resolved event. */
  applyResult(cast: ActiveCast, serverTick: number): void {
    const ability =
      ABILITY_DEFINITIONS[cast.abilityId as keyof typeof ABILITY_DEFINITIONS];
    if (!ability) {
      return;
    }

    const actor = this.getCombatantById(cast.actorId);
    if (actor) {
      applyResourceCost(actor.synced, ability.resourceCosts);
    }

    const nowMs = cast.castEndTimeMs;
    const sourceLocation = actor
      ? { x: actor.synced.x, y: actor.synced.y, z: actor.synced.z }
      : undefined;

    const castFinishEvent: AbilityCastFinishEvent = {
      eventId: 0,
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityCastFinish,
      serverTick,
      serverTimeMs: nowMs,
      contextId: this.zone.zoneData.zoneId,
      actorId: cast.actorId,
      castId: cast.castId,
      abilityId: cast.abilityId,
      sourceLocation,
    };
    this.zone.eventLog.append(castFinishEvent);

    for (const effectResult of cast.result.effects) {
      for (const targetResult of effectResult.targets) {
        const effectEvent: AbilityEffectAppliedEvent = {
          eventId: 0,
          category: EventCategory.Combat,
          eventType: CombatEventType.AbilityEffectApplied,
          serverTick,
          serverTimeMs: nowMs,
          contextId: this.zone.zoneData.zoneId,
          actorId: cast.actorId,
          castId: cast.castId,
          abilityId: cast.abilityId,
          effectId: effectResult.effectIndex,
          targetId: targetResult.targetId,
          outcome: this.mapEffectOutcome(targetResult.outcome),
          damage: targetResult.damage,
          blockedAmount: targetResult.blockedAmount,
          healing: targetResult.healing,
          statusApplied: targetResult.statusApplied,
          displacement: targetResult.displacement,
          sourceLocation,
        };
        this.zone.eventLog.append(effectEvent);
      }
    }

    for (const effectResult of cast.result.effects) {
      const effect = ability.effects[effectResult.effectIndex];
      if (!effect || effect.type !== effectResult.effectType) {
        continue;
      }

      for (const targetResult of effectResult.targets) {
        const target = this.getCombatantById(targetResult.targetId);
        if (!target) {
          continue;
        }

        if (effect.type === "damage") {
          if (targetResult.damage && targetResult.damage > 0) {
            applyDamage(target.synced, targetResult.damage);
          }
          continue;
        }

        if (effect.type === "healing") {
          if (targetResult.healing && targetResult.healing > 0) {
            applyHealing(target.synced, targetResult.healing);
          }
          continue;
        }

        if (!actor || targetResult.outcome === "no_effect") {
          continue;
        }

        const statusController = target.statusController;
        if (!statusController) {
          continue;
        }

        const definition = STATUS_DEFINITIONS[effect.statusId];
        if (!definition) {
          continue;
        }

        let durationMs = effect.durationMs;
        if (definition.maxDurationMs !== undefined) {
          durationMs = Math.min(durationMs, definition.maxDurationMs);
        }

        const appliedDefinition =
          durationMs === definition.durationMs
            ? definition
            : { ...definition, durationMs };

        statusController.applyStatus(appliedDefinition, actor.synced, nowMs);
      }
    }

    if (actor) {
      this.emit({
        type: "ability_resolved",
        ability,
        actor,
        result: cast.result,
        resolvedAtMs: nowMs,
      });
    }
  }

  /** Notify all registered ability event listeners. */
  private emit(event: AbilityEvent): void {
    for (const listener of this.listeners) {
      listener.onAbilityEvent(event);
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

  private mapEffectOutcome(
    outcome: TargetResult["outcome"],
  ): AbilityEffectAppliedEvent["outcome"] {
    if (outcome === "hit") {
      return "hit";
    }
    if (outcome === "crit") {
      return "crit";
    }
    if (outcome === "blocked") {
      return "blocked";
    }
    if (outcome === "immune") {
      return "immune";
    }
    if (outcome === "dodged") {
      return "dodged";
    }
    if (outcome === "no_effect") {
      return "no_effect";
    }
    return "miss";
  }

  private mapInterruptReason(
    reason: AbilityCancelRequest["reason"],
  ): AbilityCastInterruptEvent["reason"] {
    if (reason === "movement") {
      return "movement";
    }
    if (reason === "manual") {
      return "manual";
    }
    return "other";
  }

  /** Convert resolved target ids into synced state snapshots. */
  private resolveTargetStates(possibleTargetIds: string[]): MobState[] {
    const targets: MobState[] = [];
    for (const id of possibleTargetIds) {
      const target = this.getCombatantById(id);
      if (target) {
        targets.push(target.synced);
      }
    }
    return targets;
  }

  /** Accept a validated request into the cast queue and build its ack. */
  private acceptIntoCastQueue(
    actor: ServerMob<MobState>,
    request: AbilityUseRequest,
    validation: ValidationSuccess,
    serverTimeMs: number,
    serverTick: number,
  ): AbilityAck {
    const ability = validation.ability;
    const castStartTimeMs = serverTimeMs;
    const castEndTimeMs = serverTimeMs + ability.castTimeMs;

    const gcdDurationMs = Math.max(GCD_MS, ability.castTimeMs);
    const gcdEndTimeMs = computeGcdEndTimeMs(
      ability.isOnGcd,
      castStartTimeMs,
      gcdDurationMs,
    );

    const abilityState = actor.synced.abilityState;
    abilityState.castStartTimeMs = castStartTimeMs;
    abilityState.castEndTimeMs = castEndTimeMs;
    abilityState.castAbilityId = ability.id;

    if (gcdEndTimeMs !== null) {
      abilityState.gcdEndTimeMs = gcdEndTimeMs;
    }
    if (ability.castTimeMs < INTERNAL_COOLDOWN_MS) {
      abilityState.internalCooldownEndTimeMs =
        castStartTimeMs + INTERNAL_COOLDOWN_MS;
    }

    const targets = this.resolveTargetStates(validation.possibleTargetIds);
    const rngSeed = hashStringToUint32(
      `${request.requestId}:${request.actorId}:${serverTick}`,
    );
    const result = resolveAbilityOutcome(
      ability,
      actor.synced,
      targets,
      rngSeed,
    );

    const castId = this.nextCastId;
    this.nextCastId += 1;

    actor.activeCast = {
      castId,
      actorId: request.actorId,
      abilityId: ability.id,
      requestId: request.requestId,
      sequence: request.sequence,
      serverTick,
      castStartTimeMs,
      castEndTimeMs,
      result,
    };

    const castStartEvent: AbilityCastStartEvent = {
      eventId: 0,
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityCastStart,
      serverTick,
      serverTimeMs,
      contextId: this.zone.zoneData.zoneId,
      actorId: request.actorId,
      castId,
      abilityId: ability.id,
      target: request.target,
      gcdStartTimeMs: ability.isOnGcd ? castStartTimeMs : undefined,
      gcdEndTimeMs: ability.isOnGcd ? (gcdEndTimeMs ?? undefined) : undefined,
      castStartTimeMs,
      castEndTimeMs,
      sourceLocation: {
        x: actor.synced.x,
        y: actor.synced.y,
        z: actor.synced.z,
      },
    };
    this.zone.eventLog.append(castStartEvent);

    return {
      type: "ability_ack",
      requestId: request.requestId,
      sequence: request.sequence,
      accepted: true,
      serverTimeMs,
      serverTick,
      castStartTimeMs,
      castEndTimeMs,
      gcdStartTimeMs: ability.isOnGcd ? castStartTimeMs : undefined,
      gcdEndTimeMs: ability.isOnGcd ? (gcdEndTimeMs ?? undefined) : undefined,
      result,
    };
  }

  /** Validate resource costs, cooldowns, and targeting for an ability use. */
  private validateAbilityUse(
    actor: ServerMob<MobState>,
    request: AbilityUseRequest,
    serverTimeMs: number,
    options?: {
      ignoreGcd?: boolean;
    },
  ): ValidationResult {
    const ability =
      ABILITY_DEFINITIONS[
        request.abilityId as keyof typeof ABILITY_DEFINITIONS
      ];
    if (!ability) {
      return { accepted: false, rejectReason: "illegal" };
    }

    const abilityGate = actor.canUseAbility(ability);
    if (!abilityGate.canUse) {
      return { accepted: false, rejectReason: abilityGate.reason };
    }

    const abilityState = actor.synced.abilityState;
    if (
      ability.isOnGcd &&
      !options?.ignoreGcd &&
      !abilityState.isGcdReady(serverTimeMs)
    ) {
      return { accepted: false, rejectReason: "cooldown" };
    }

    if (abilityState.isInternalCooldownActive(serverTimeMs)) {
      return { accepted: false, rejectReason: "cooldown" };
    }

    const abilityCooldownEnd = actor.cooldowns.get(ability.id);
    if (abilityCooldownEnd && serverTimeMs < abilityCooldownEnd) {
      return { accepted: false, rejectReason: "cooldown" };
    }

    if (!canPayResourceCost(actor.synced, ability.resourceCosts)) {
      return { accepted: false, rejectReason: "resources" };
    }

    const targeting = this.resolveTargeting(ability, request.target, actor);
    if (!targeting) {
      return { accepted: false, rejectReason: "illegal" };
    }

    if (targeting.targetPosition) {
      const inRange = this.isInRange(
        actor,
        targeting.targetPosition,
        ability.range,
      );
      if (!inRange) {
        return { accepted: false, rejectReason: "out_of_range" };
      }

      if (!this.hasLineOfSight(actor, targeting.targetPosition)) {
        return { accepted: false, rejectReason: "out_of_range" };
      }
    }

    return {
      accepted: true,
      ability,
      targetPosition: targeting.targetPosition,
      possibleTargetIds: targeting.possibleTargetIds,
    };
  }

  /** Resolve possible targets and target position for a request. */
  private resolveTargeting(
    ability: AbilityDefinition,
    target: TargetSpec,
    actor: ServerMob<MobState>,
  ): {
    targetPosition?: { x: number; y: number; z: number };
    possibleTargetIds: string[];
  } | null {
    const candidates = this.collectTargetCandidates(actor);
    const resolved = resolveTargetsForAbility({
      ability,
      actor: {
        id: actor.id,
        x: actor.synced.x,
        y: actor.synced.y,
        z: actor.synced.z,
        facingYaw: actor.synced.facingYaw,
      },
      target,
      candidates,
    });

    if (!resolved) {
      return null;
    }

    return {
      possibleTargetIds: resolved.possibleTargetIds,
      targetPosition: resolved.targetPosition,
    };
  }

  /** Build a standardized rejection ack. */
  private buildRejectAck(
    request: AbilityUseRequest,
    serverTimeMs: number,
    serverTick: number,
    reason: AbilityAckRejectReason,
  ): AbilityAck {
    return {
      type: "ability_ack",
      requestId: request.requestId,
      sequence: request.sequence,
      accepted: false,
      serverTimeMs,
      serverTick,
      castStartTimeMs: 0,
      castEndTimeMs: 0,
      rejectReason: reason ?? "other",
    };
  }

  /** Range check between actor and a target position. */
  private isInRange(
    actor: ServerMob<MobState>,
    targetPosition: { x: number; y: number; z: number },
    range: number,
  ): boolean {
    const dx = targetPosition.x - actor.synced.x;
    const dy = targetPosition.y - actor.synced.y;
    const dz = targetPosition.z - actor.synced.z;
    return dx * dx + dy * dy + dz * dz <= range * range;
  }

  /** Line-of-sight check between actor and a target position. */
  private hasLineOfSight(
    actor: ServerMob<MobState>,
    targetPosition: { x: number; y: number; z: number },
  ): boolean {
    const navmesh = this.zone.zoneData.navmeshQuery;
    if (!navmesh) {
      return true;
    }
    return hasLineOfSight(
      navmesh,
      { x: actor.synced.x, y: actor.synced.y, z: actor.synced.z },
      targetPosition,
    );
  }

  /** Gather target candidates for targeting resolution. */
  private collectTargetCandidates(
    actor: ServerMob<MobState>,
  ): TargetCandidate[] {
    const candidates: TargetCandidate[] = [];

    candidates.push({
      id: actor.id,
      x: actor.synced.x,
      y: actor.synced.y,
      z: actor.synced.z,
    });

    for (const player of this.zone.players.values()) {
      if (player.id === actor.id) {
        continue;
      }
      candidates.push({
        id: player.id,
        x: player.synced.x,
        y: player.synced.y,
        z: player.synced.z,
      });
    }

    for (const npc of this.zone.npcs.values()) {
      if (npc.id === actor.id) {
        continue;
      }
      candidates.push({
        id: npc.id,
        x: npc.synced.x,
        y: npc.synced.y,
        z: npc.synced.z,
      });
    }

    return candidates;
  }
}
