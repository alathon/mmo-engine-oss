import {
  ABILITY_DEFINITIONS,
  BUFFER_OPEN_MS,
  GCD_SECONDS,
  INTERNAL_COOLDOWN_MS,
  type AbilityAck,
  type AbilityCancelRequest,
  type AbilityCastInterruptEvent,
  type AbilityUseRequest,
  type TargetSpec,
} from "@mmo/shared";
import type { ZoneConnectionManager } from "../network/zone-connection-manager";
import { CombatPredictionState } from "./combat-prediction-state";
import type { MobEntity } from "../entities/mob-entity";

export interface CooldownVisualState {
  active: boolean;
  ratio: number;
  remainingMs: number;
}

export interface ClientCombatStateSnapshot {
  gcd: CooldownVisualState;
  internalCooldown: CooldownVisualState;
  queuedAbilityId?: string;
}

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
    const requestPrediction = this.prediction.getRequestPrediction(ack.requestId);
    const clientNowMs = Date.now();

    if (ack.accepted && isCanceledRequest) {
      this.prediction.clearQueuedAbilityIfMatches(ack.requestId);
      this.prediction.clearRequestPrediction(ack.requestId);
      return;
    }

    if (!ack.accepted) {
      this.prediction.clearQueuedAbilityIfMatches(ack.requestId);
      const keepOptimisticCooldown =
        ack.rejectReason === "cooldown" ||
        ack.rejectReason === "buffer_full" ||
        ack.rejectReason === "buffer_window_closed";
      const shouldRollbackPrediction =
        !keepOptimisticCooldown && (requestPrediction?.appliesOptimisticCooldowns ?? true);
      if (shouldRollbackPrediction) {
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
        const abilityId = requestPrediction?.abilityId ?? this.prediction.getLastRequestAbilityId();
        if (abilityId) {
          this.prediction.setAbilityCooldown(abilityId, clientNowMs);
        }
      }
      this.prediction.clearRequestPrediction(ack.requestId);
      return;
    }

    if (ack.gcdEndTimeMs !== undefined) {
      const remainingGcdMs = Math.max(0, ack.gcdEndTimeMs - ack.serverTimeMs);
      const localGcdEndTimeMs = clientNowMs + remainingGcdMs;
      const shouldAdoptGcdWindow =
        this.prediction.predictedGcdEndTimeMs <= clientNowMs ||
        localGcdEndTimeMs < this.prediction.predictedGcdEndTimeMs;
      if (shouldAdoptGcdWindow) {
        const gcdStartTimeMs = ack.gcdStartTimeMs ?? ack.castStartTimeMs;
        const remainingGcdStartMs = Math.max(0, gcdStartTimeMs - ack.serverTimeMs);
        const localGcdStartTimeMs = clientNowMs + remainingGcdStartMs;
        this.prediction.predictedGcdEndTimeMs = localGcdEndTimeMs;
        this.prediction.predictedGcdStartTimeMs = Math.min(localGcdStartTimeMs, localGcdEndTimeMs);
      }
    }

    const abilityId = ack.result?.abilityId;
    if (abilityId) {
      const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
      if (ability) {
        if (ability.castTimeMs < INTERNAL_COOLDOWN_MS) {
          const internalEndTimeMs = ack.castStartTimeMs + INTERNAL_COOLDOWN_MS;
          const remainingInternalMs = Math.max(0, internalEndTimeMs - ack.serverTimeMs);
          const localInternalEndTimeMs = clientNowMs + remainingInternalMs;
          if (
            this.prediction.predictedInternalCooldownEndTimeMs <= clientNowMs ||
            localInternalEndTimeMs < this.prediction.predictedInternalCooldownEndTimeMs
          ) {
            this.prediction.predictedInternalCooldownEndTimeMs = localInternalEndTimeMs;
          }
        }

        const currentCooldown = this.prediction.getAbilityCooldownEndTime(abilityId);
        const remainingCastMs = Math.max(0, ack.castEndTimeMs - ack.serverTimeMs);
        const localCooldownEndTimeMs = clientNowMs + remainingCastMs + ability.cooldownMs;
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
    this.prediction.clearRequestPrediction(ack.requestId);
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
      this.source.sync.abilityState.castAbilityId || this.prediction.getLastRequestAbilityId();
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
      typeof this.lastAckCastId === "number" && event.castId === this.lastAckCastId;

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

  /**
   * Exposes prediction internals for tests only.
   */
  getPredictionState(): CombatPredictionState {
    return this.prediction;
  }

  canBufferAbility(abilityId: string, nowMs: number): boolean {
    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
    if (!ability) {
      return false;
    }

    if (!this.prediction.canBufferAbility(ability, nowMs)) {
      return false;
    }

    if (!ability.isOnGcd) {
      return true;
    }

    const isCasting = this.source.sync.abilityState.isCasting(nowMs);
    const isGcdBlocking = nowMs < this.prediction.predictedGcdEndTimeMs;
    if (!isCasting && !isGcdBlocking) {
      return true;
    }

    return this.isBufferWindowOpen(nowMs);
  }

  getCastingAbilityId(nowMs: number): string | undefined {
    const abilityState = this.source.sync.abilityState;
    if (!abilityState.isCasting(nowMs)) {
      return undefined;
    }
    return abilityState.castAbilityId || undefined;
  }

  isUsingAbility(abilityId: string, nowMs: number): boolean {
    return this.getCastingAbilityId(nowMs) === abilityId;
  }

  getGcdState(nowMs: number): CooldownVisualState {
    const gcdStart = this.prediction.getPredictedGcdStartTimeMs();
    const gcdEnd = this.prediction.getPredictedGcdEndTimeMs();
    const visualGcdEnd = Math.min(gcdEnd, gcdStart + GCD_VISUAL_MS);
    if (visualGcdEnd <= nowMs || visualGcdEnd <= gcdStart || nowMs < gcdStart) {
      return { active: false, ratio: 0, remainingMs: 0 };
    }

    const remainingMs = Math.max(0, visualGcdEnd - nowMs);
    const durationMs = Math.max(1, visualGcdEnd - gcdStart);
    return {
      active: remainingMs > 0,
      ratio: clamp(remainingMs / durationMs, 0, 1),
      remainingMs,
    };
  }

  getInternalCooldownState(nowMs: number): CooldownVisualState {
    const internalCooldownEndMs = this.prediction.predictedInternalCooldownEndTimeMs;
    if (internalCooldownEndMs <= nowMs) {
      return { active: false, ratio: 0, remainingMs: 0 };
    }

    const remainingMs = Math.max(0, internalCooldownEndMs - nowMs);
    return {
      active: remainingMs > 0,
      ratio: remainingMs > 0 ? 1 : 0,
      remainingMs,
    };
  }

  getAbilityCooldownState(abilityId: string, nowMs: number): CooldownVisualState {
    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
    if (!ability || ability.cooldownMs <= 0) {
      return { active: false, ratio: 0, remainingMs: 0 };
    }

    const cooldownEnd = this.prediction.getAbilityCooldownEndTime(abilityId);
    if (cooldownEnd === undefined) {
      return { active: false, ratio: 0, remainingMs: 0 };
    }

    const cooldownStart = cooldownEnd - ability.cooldownMs;
    if (nowMs < cooldownStart) {
      return { active: false, ratio: 0, remainingMs: 0 };
    }

    const remainingMs = Math.max(0, cooldownEnd - nowMs);
    return {
      active: remainingMs > 0,
      ratio: clamp(remainingMs / ability.cooldownMs, 0, 1),
      remainingMs,
    };
  }

  getClientCombatState(nowMs: number): ClientCombatStateSnapshot {
    return {
      gcd: this.getGcdState(nowMs),
      internalCooldown: this.getInternalCooldownState(nowMs),
      queuedAbilityId: this.prediction.queuedAbilityId,
    };
  }

  getLastAck(): AbilityAck | undefined {
    return this.lastAck;
  }

  tryUseAbility(abilityId: string, context?: AbilityUseContext): void {
    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
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
      if (!this.canBufferAbility(ability.id, nowMs)) {
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

    const isGcdBlocking = ability.isOnGcd && nowMs < this.prediction.predictedGcdEndTimeMs;
    if (isGcdBlocking) {
      if (!this.canBufferAbility(ability.id, nowMs)) {
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

  private isBufferWindowOpen(nowMs: number): boolean {
    const abilityState = this.source.sync.abilityState;
    if (abilityState.isCasting(nowMs)) {
      const predictedStartTimeMs = this.prediction.getPredictedGcdStartTimeMs();
      const bufferStartTimeMs =
        predictedStartTimeMs > 0 ? predictedStartTimeMs : abilityState.castStartTimeMs;
      return nowMs >= bufferStartTimeMs + BUFFER_OPEN_MS;
    }

    const gcdStartTimeMs = this.prediction.getPredictedGcdStartTimeMs();
    const gcdEndTimeMs = this.prediction.getPredictedGcdEndTimeMs();
    if (gcdStartTimeMs <= 0 || nowMs >= gcdEndTimeMs) {
      return true;
    }

    return nowMs >= gcdStartTimeMs + BUFFER_OPEN_MS;
  }

  private cancelIfMovingDuringCast(ability: { castTimeMs: number }): void {
    if (this.movementActive && ability.castTimeMs > 0) {
      this.cancelActiveCast("movement");
    }
  }

  private clearPredictionAfterInterrupt(nowMs: number, abilityId?: string): void {
    this.prediction.predictedGcdEndTimeMs = Math.min(this.prediction.predictedGcdEndTimeMs, nowMs);
    this.prediction.predictedGcdStartTimeMs = Math.min(
      this.prediction.predictedGcdStartTimeMs,
      nowMs,
    );
    this.prediction.predictedInternalCooldownEndTimeMs = Math.min(
      this.prediction.predictedInternalCooldownEndTimeMs,
      nowMs,
    );
    this.prediction.queuedAbilityId = undefined;
    const resolvedAbilityId = abilityId ?? this.prediction.getLastRequestAbilityId();
    if (resolvedAbilityId) {
      this.prediction.setAbilityCooldown(resolvedAbilityId, nowMs);
    }
  }

  private resolveTargetSpec(
    targetType: "self" | "enemy" | "ally" | "ground",
    context?: AbilityUseContext,
  ): TargetSpec | undefined {
    switch (targetType) {
      case "self": {
        return {
          targetEntityId: this.actorId,
          targetPoint: context?.targetPoint,
          direction: context?.direction,
        };
      }
      case "enemy":
      case "ally": {
        const targetEntityId = context?.targetEntityId;
        if (!targetEntityId) {
          return undefined;
        }
        return {
          targetEntityId,
          targetPoint: context?.targetPoint,
          direction: context?.direction,
        };
      }
      case "ground": {
        if (!context?.targetPoint) {
          return undefined;
        }
        return {
          targetPoint: context.targetPoint,
          direction: context.direction,
        };
      }
      default: {
        return undefined;
      }
    }
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const GCD_VISUAL_MS = GCD_SECONDS * 1000;
