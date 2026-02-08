import {
  GCD_SECONDS,
  INTERNAL_COOLDOWN_MS,
  type AbilityAck,
  type AbilityDefinition,
} from "@mmo/shared";

const GCD_MS = GCD_SECONDS * 1000;

export class CombatPredictionState {
  predictedGcdEndTimeMs = 0;
  predictedGcdStartTimeMs = 0;
  predictedInternalCooldownEndTimeMs = 0;
  queuedAbilityId?: string;

  private abilityCooldowns = new Map<string, number>();
  private lastAckSequence = 0;
  private lastAckRequestId?: string;
  private lastRequestId?: string;
  private lastRequestSequence = 0;
  private lastRequestAbilityId?: string;
  private lastRequestTimeMs = 0;

  canAttemptAbility(ability: AbilityDefinition, nowMs: number): boolean {
    if (ability.isOnGcd && nowMs < this.predictedGcdEndTimeMs) {
      return false;
    }

    if (nowMs < this.predictedInternalCooldownEndTimeMs) {
      return false;
    }

    const cooldownEnd = this.abilityCooldowns.get(ability.id);
    if (cooldownEnd !== undefined && nowMs < cooldownEnd) {
      return false;
    }

    return true;
  }

  canBufferAbility(ability: AbilityDefinition, nowMs: number): boolean {
    if (nowMs < this.predictedInternalCooldownEndTimeMs) {
      return false;
    }

    const cooldownEnd = this.abilityCooldowns.get(ability.id);
    if (cooldownEnd !== undefined && nowMs < cooldownEnd) {
      return false;
    }

    return true;
  }

  markAbilityRequested(
    ability: AbilityDefinition,
    requestId: string,
    sequence: number,
    nowMs: number,
  ): void {
    this.lastRequestId = requestId;
    this.lastRequestSequence = sequence;
    this.lastRequestAbilityId = ability.id;
    this.lastRequestTimeMs = nowMs;

    if (ability.castTimeMs < INTERNAL_COOLDOWN_MS) {
      this.predictedInternalCooldownEndTimeMs = nowMs + INTERNAL_COOLDOWN_MS;
    }
    if (ability.isOnGcd) {
      this.predictedGcdStartTimeMs = nowMs + ability.castTimeMs;
      this.predictedGcdEndTimeMs = nowMs + Math.max(GCD_MS, ability.castTimeMs);
    }

    this.abilityCooldowns.set(
      ability.id,
      nowMs + ability.castTimeMs + ability.cooldownMs,
    );
  }

  markAbilityBuffered(
    ability: AbilityDefinition,
    requestId: string,
    sequence: number,
    nowMs: number,
  ): void {
    this.lastRequestId = requestId;
    this.lastRequestSequence = sequence;
    this.lastRequestAbilityId = ability.id;
    this.lastRequestTimeMs = nowMs;
    this.queuedAbilityId = ability.id;
  }

  setAbilityCooldown(abilityId: string, cooldownEndTimeMs: number): void {
    this.abilityCooldowns.set(abilityId, cooldownEndTimeMs);
  }

  getAbilityCooldownEndTime(abilityId: string): number | undefined {
    return this.abilityCooldowns.get(abilityId);
  }

  getAbilitiesOnCooldown(): ReadonlyMap<string, number> {
    return this.abilityCooldowns;
  }

  getPredictedGcdStartTimeMs(): number {
    return this.predictedGcdStartTimeMs;
  }

  getPredictedGcdEndTimeMs(): number {
    return this.predictedGcdEndTimeMs;
  }

  isAckStale(ack: AbilityAck): boolean {
    if (ack.sequence < this.lastAckSequence) {
      return true;
    }

    if (ack.sequence === this.lastAckSequence && this.lastAckRequestId) {
      return ack.requestId !== this.lastAckRequestId;
    }

    return false;
  }

  recordAck(ack: AbilityAck): void {
    this.lastAckSequence = ack.sequence;
    this.lastAckRequestId = ack.requestId;
  }

  clearQueuedAbilityIfMatches(requestId: string): void {
    if (this.lastRequestId === requestId) {
      this.queuedAbilityId = undefined;
    }
  }

  getLastRequestAbilityId(): string | undefined {
    return this.lastRequestAbilityId;
  }

  getLastRequestTimeMs(): number {
    return this.lastRequestTimeMs;
  }

  getLastRequestSequence(): number {
    return this.lastRequestSequence;
  }

  getLastRequestId(): string | undefined {
    return this.lastRequestId;
  }
}
