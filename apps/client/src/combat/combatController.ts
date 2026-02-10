import {
  ABILITY_DEFINITIONS,
  INTERNAL_COOLDOWN_MS,
  type AbilityAck,
  type AbilityCancelRequest,
  type AbilityCastInterruptEvent,
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
  private lastAckCastId?: number;
  private lastPredictedCancelCastId?: number;
  private pendingCastRequestId?: string;
  private pendingCancelRequestId?: string;
  private movementActive = false;

  constructor(source: MobEntity, zoneNetwork: ZoneConnectionManager) {
    this.source = source;
    this.actorId = this.source.getId();
    this.zoneNetwork = zoneNetwork;
    this.prediction = new CombatPredictionState();
  }

  fixedTick(): void {
    this.currentTick += 1;
  }

  setMovementActive(isMoving: boolean): void {
    this.movementActive = isMoving;
  }

  applyAck(ack: AbilityAck): void {
    if (this.prediction.isAckStale(ack)) {
      return;
    }

    const isCanceledRequest = this.pendingCancelRequestId === ack.requestId;
    this.lastAck = ack;
    if (ack.accepted && typeof ack.castId === "number") {
      this.lastAckCastId = ack.castId;
      if (this.pendingCastRequestId === ack.requestId) {
        this.pendingCastRequestId = undefined;
      }
      if (this.pendingCancelRequestId === ack.requestId) {
        this.lastPredictedCancelCastId = ack.castId;
        this.pendingCancelRequestId = undefined;
      }
    } else if (this.pendingCancelRequestId === ack.requestId) {
      this.pendingCancelRequestId = undefined;
    }
    if (this.pendingCastRequestId === ack.requestId && !ack.accepted) {
      this.pendingCastRequestId = undefined;
    }
    this.prediction.recordAck(ack);
    const clientNowMs = Date.now();

    if (ack.accepted && isCanceledRequest) {
      this.prediction.clearQueuedAbilityIfMatches(ack.requestId);
      return;
    }

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
    const activeCastId = this.source.sync.abilityState.castId;
    if (activeCastId > 0) {
      this.lastPredictedCancelCastId = activeCastId;
    }
    this.pendingCancelRequestId = requestId;
    const activeAbilityId =
      this.source.sync.abilityState.castAbilityId ||
      this.prediction.getLastRequestAbilityId();
    this.clearPredictionAfterInterrupt(nowMs, activeAbilityId);

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

  handleServerCastInterrupt(event: AbilityCastInterruptEvent): void {
    if (event.actorId !== this.actorId) {
      return;
    }

    const currentCastId = this.source.sync.abilityState.castId;
    const matchesCurrent = currentCastId > 0 && event.castId === currentCastId;
    const matchesAck =
      typeof this.lastAckCastId === "number" &&
      event.castId === this.lastAckCastId;

    if (!matchesCurrent && !matchesAck) {
      return;
    }
    if (!matchesCurrent && this.pendingCastRequestId) {
      return;
    }

    if (this.lastPredictedCancelCastId === event.castId) {
      this.lastPredictedCancelCastId = undefined;
      return;
    }

    this.clearPredictionAfterInterrupt(Date.now(), event.abilityId);
  }

  getPredictionState(): CombatPredictionState {
    return this.prediction;
  }

  getCastingAbilityId(nowMs: number): string | undefined {
    const abilityState = this.source.sync.abilityState;
    if (!abilityState.isCasting(nowMs)) {
      return undefined;
    }
    return abilityState.castAbilityId || undefined;
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

    if (this.movementActive && ability.castTimeMs > 0) {
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
      this.cancelIfMovingDuringCast(ability);
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
      this.cancelIfMovingDuringCast(ability);
      return;
    }

    if (!this.prediction.canAttemptAbility(ability, nowMs)) {
      return;
    }

    const sequence = this.currentSequence++;
    const requestId = `ability-${this.actorId}-${sequence}`;

    this.prediction.markAbilityRequested(ability, requestId, sequence, nowMs);
    this.prediction.queuedAbilityId = undefined;
    if (ability.castTimeMs > 0) {
      this.pendingCastRequestId = requestId;
    }

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
    this.cancelIfMovingDuringCast(ability);
  }

  private cancelIfMovingDuringCast(ability: { castTimeMs: number }): void {
    if (this.movementActive && ability.castTimeMs > 0) {
      this.cancelActiveCast("movement");
    }
  }

  private clearPredictionAfterInterrupt(
    nowMs: number,
    abilityId?: string,
  ): void {
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
    const resolvedAbilityId =
      abilityId ?? this.prediction.getLastRequestAbilityId();
    if (resolvedAbilityId) {
      this.prediction.setAbilityCooldown(resolvedAbilityId, nowMs);
    }
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
