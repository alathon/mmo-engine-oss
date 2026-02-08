import {
  ABILITY_DEFINITIONS,
  INTERNAL_COOLDOWN_MS,
  type AbilityAck,
  type AbilityCancelRequest,
  type AbilityUseRequest,
  type TargetSpec,
} from "@mmo/shared";
import type { ZoneConnectionManager } from "../network/zoneConnectionManager";
import { CombatPredictionState } from "./combatPredictionState";
import type { MobEntity } from "../entities/mobEntity";

export interface AbilityUseContext {
  targetEntityId?: string;
  targetPoint?: { x: number; y: number; z: number };
  direction?: { x: number; y: number; z: number };
}

/**
 * Client-side combat controller that owns prediction, input, and reconciliation.
 */
export class CombatController {
  private currentTick = 0;
  private currentSequence = 1;
  private readonly actorId: string;
  private readonly source: MobEntity;
  private readonly zoneNetwork: ZoneConnectionManager;
  private readonly prediction: CombatPredictionState;
  private lastAck?: AbilityAck;

  constructor(source: MobEntity, zoneNetwork: ZoneConnectionManager) {
    this.source = source;
    this.actorId = this.source.getId();
    this.zoneNetwork = zoneNetwork;
    this.prediction = new CombatPredictionState();
  }

  fixedTick(): void {
    this.currentTick += 1;
  }

  applyAck(ack: AbilityAck): void {
    if (this.prediction.isAckStale(ack)) {
      return;
    }

    this.lastAck = ack;
    this.prediction.recordAck(ack);
    const clientNowMs = Date.now();

    if (!ack.accepted) {
      this.prediction.clearQueuedAbilityIfMatches(ack.requestId);
      const keepOptimisticCooldown =
        ack.rejectReason === "cooldown" ||
        ack.rejectReason === "buffer_full" ||
        ack.rejectReason === "buffer_window_closed";
      if (!keepOptimisticCooldown) {
        this.prediction.predictedGcdEndTimeMs = Math.min(
          this.prediction.predictedGcdEndTimeMs,
          clientNowMs,
        );
        this.prediction.predictedGcdStartTimeMs = Math.min(
          this.prediction.predictedGcdStartTimeMs,
          clientNowMs,
        );
        this.prediction.predictedInternalCooldownEndTimeMs = Math.min(
          this.prediction.predictedInternalCooldownEndTimeMs,
          clientNowMs,
        );
        const abilityId = this.prediction.getLastRequestAbilityId();
        if (abilityId) {
          this.prediction.setAbilityCooldown(abilityId, clientNowMs);
        }
      }
      return;
    }

    if (ack.gcdEndTimeMs !== undefined) {
      const remainingGcdMs = Math.max(0, ack.gcdEndTimeMs - ack.serverTimeMs);
      const localGcdEndTimeMs = clientNowMs + remainingGcdMs;
      if (
        this.prediction.predictedGcdEndTimeMs <= clientNowMs ||
        localGcdEndTimeMs < this.prediction.predictedGcdEndTimeMs
      ) {
        this.prediction.predictedGcdEndTimeMs = localGcdEndTimeMs;
      }
    }

    const abilityId = ack.result?.abilityId;
    if (abilityId) {
      const ability =
        ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
      if (ability) {
        if (ability.castTimeMs < INTERNAL_COOLDOWN_MS) {
          const internalEndTimeMs = ack.castStartTimeMs + INTERNAL_COOLDOWN_MS;
          const remainingInternalMs = Math.max(
            0,
            internalEndTimeMs - ack.serverTimeMs,
          );
          const localInternalEndTimeMs = clientNowMs + remainingInternalMs;
          if (
            this.prediction.predictedInternalCooldownEndTimeMs <= clientNowMs ||
            localInternalEndTimeMs <
              this.prediction.predictedInternalCooldownEndTimeMs
          ) {
            this.prediction.predictedInternalCooldownEndTimeMs =
              localInternalEndTimeMs;
          }
        }

        const currentCooldown =
          this.prediction.getAbilityCooldownEndTime(abilityId);
        const remainingCastMs = Math.max(
          0,
          ack.castEndTimeMs - ack.serverTimeMs,
        );
        const localCooldownEndTimeMs =
          clientNowMs + remainingCastMs + ability.cooldownMs;
        if (
          currentCooldown === undefined ||
          currentCooldown <= clientNowMs ||
          localCooldownEndTimeMs < currentCooldown
        ) {
          this.prediction.setAbilityCooldown(abilityId, localCooldownEndTimeMs);
        }
      }
    }

    this.prediction.clearQueuedAbilityIfMatches(ack.requestId);
  }

  cancelActiveCast(reason: AbilityCancelRequest["reason"] = "manual"): void {
    const requestId = this.prediction.getLastRequestId();
    if (!requestId) {
      return;
    }

    const nowMs = Date.now();
    this.prediction.predictedGcdEndTimeMs = Math.min(
      this.prediction.predictedGcdEndTimeMs,
      nowMs,
    );
    this.prediction.predictedGcdStartTimeMs = Math.min(
      this.prediction.predictedGcdStartTimeMs,
      nowMs,
    );
    this.prediction.predictedInternalCooldownEndTimeMs = Math.min(
      this.prediction.predictedInternalCooldownEndTimeMs,
      nowMs,
    );
    this.prediction.queuedAbilityId = undefined;
    const lastAbilityId = this.prediction.getLastRequestAbilityId();
    if (lastAbilityId) {
      this.prediction.setAbilityCooldown(lastAbilityId, nowMs);
    }

    const request: AbilityCancelRequest = {
      type: "ability_cancel",
      requestId,
      sequence: this.prediction.getLastRequestSequence(),
      clientTick: this.currentTick,
      actorId: this.actorId,
      reason,
      clientTimeMs: Date.now(),
    };

    this.zoneNetwork.sendAbilityCancel(request);
  }

  getPredictionState(): CombatPredictionState {
    return this.prediction;
  }

  getLastAck(): AbilityAck | undefined {
    return this.lastAck;
  }

  tryUseAbility(abilityId: string, context?: AbilityUseContext): void {
    const ability =
      ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
    if (!ability) {
      return;
    }

    const target = this.resolveTargetSpec(ability.targetType, context);
    if (!target) {
      return;
    }

    const nowMs = Date.now();
    const isCasting = this.source.sync.abilityState.isCasting(nowMs);

    if (isCasting) {
      if (!ability.isOnGcd) {
        return;
      }
      if (!this.prediction.canBufferAbility(ability, nowMs)) {
        return;
      }

      const sequence = this.currentSequence++;
      const requestId = `ability-${this.actorId}-${sequence}`;
      this.prediction.markAbilityBuffered(ability, requestId, sequence, nowMs);

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId,
        sequence,
        clientTick: this.currentTick,
        actorId: this.actorId,
        abilityId: ability.id,
        target,
        clientTimeMs: Date.now(),
      };

      this.zoneNetwork.sendAbilityUse(request);
      return;
    }

    const isGcdBlocking =
      ability.isOnGcd && nowMs < this.prediction.predictedGcdEndTimeMs;
    if (isGcdBlocking) {
      if (!this.prediction.canBufferAbility(ability, nowMs)) {
        return;
      }

      const sequence = this.currentSequence++;
      const requestId = `ability-${this.actorId}-${sequence}`;
      this.prediction.markAbilityBuffered(ability, requestId, sequence, nowMs);

      const request: AbilityUseRequest = {
        type: "ability_use",
        requestId,
        sequence,
        clientTick: this.currentTick,
        actorId: this.actorId,
        abilityId: ability.id,
        target,
        clientTimeMs: Date.now(),
      };

      this.zoneNetwork.sendAbilityUse(request);
      return;
    }

    if (!this.prediction.canAttemptAbility(ability, nowMs)) {
      return;
    }

    const sequence = this.currentSequence++;
    const requestId = `ability-${this.actorId}-${sequence}`;

    this.prediction.markAbilityRequested(ability, requestId, sequence, nowMs);
    this.prediction.queuedAbilityId = undefined;

    const request: AbilityUseRequest = {
      type: "ability_use",
      requestId,
      sequence,
      clientTick: this.currentTick,
      actorId: this.actorId,
      abilityId: ability.id,
      target,
      clientTimeMs: Date.now(),
    };

    this.zoneNetwork.sendAbilityUse(request);
  }

  private resolveTargetSpec(
    targetType: "self" | "enemy" | "ally" | "ground",
    context?: AbilityUseContext,
  ): TargetSpec | null {
    switch (targetType) {
      case "self":
        return {
          targetEntityId: this.actorId,
          targetPoint: context?.targetPoint,
          direction: context?.direction,
        };
      case "enemy":
      case "ally": {
        const targetEntityId = context?.targetEntityId;
        if (!targetEntityId) {
          return null;
        }
        return {
          targetEntityId,
          targetPoint: context?.targetPoint,
          direction: context?.direction,
        };
      }
      case "ground": {
        if (!context?.targetPoint) {
          return null;
        }
        return {
          targetPoint: context.targetPoint,
          direction: context.direction,
        };
      }
      default:
        return null;
    }
  }
}
