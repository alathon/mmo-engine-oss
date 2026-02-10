import { describe, expect, it, vi } from 'vitest';
import {
  ABILITY_DEFINITIONS,
  AbilityState,
  type AbilityAck,
  type AbilityUseRequest,
} from '@mmo/shared';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ZoneConnectionManager } from '../network/zone-connection-manager';
import { CombatController } from './combat-controller';
import type { MobEntity } from '../entities/mob-entity';

const createController = (onSend: (request: AbilityUseRequest) => void): CombatController => {
  const zoneNetwork = new ZoneConnectionManager();
  (zoneNetwork as unknown as { sendAbilityUse: (r: AbilityUseRequest) => void }).sendAbilityUse =
    onSend;
  (zoneNetwork as unknown as { sendAbilityCancel: (r: unknown) => void }).sendAbilityCancel = (
    _request: unknown
  ) => {};

  const source = {
    getId: () => 'player-1',
    getPosition: () => new Vector3(1, 0, 2),
    sync: {
      abilityState: new AbilityState({
        castStartTimeMs: 0,
        castEndTimeMs: 0,
      }),
    },
  } as unknown as MobEntity;

  return new CombatController(source, zoneNetwork);
};

describe('CombatController', () => {
  it('sends ability use requests when triggered', () => {
    const sent: AbilityUseRequest[] = [];
    const controller = createController((request) => sent.push(request));

    controller.fixedTick();
    controller.tryUseAbility('quick_dart', { targetEntityId: 'player-1' });

    expect(sent).toHaveLength(1);
    expect(sent[0].abilityId).toBe('quick_dart');
    expect(sent[0].actorId).toBe('player-1');
    expect(sent[0].clientTick).toBe(1);
    expect(sent[0].sequence).toBe(1);
  });

  it('buffers on-GCD abilities when gcd is active', () => {
    const sent: AbilityUseRequest[] = [];
    const controller = createController((request) => sent.push(request));
    const prediction = controller.getPredictionState();
    prediction.predictedGcdEndTimeMs = Date.now() + 1000;

    controller.fixedTick();
    controller.tryUseAbility('shield_bash', { targetEntityId: 'player-1' });

    expect(sent).toHaveLength(1);
    expect(prediction.queuedAbilityId).toBe('shield_bash');
  });

  it('rejects oGCD attempts while casting but buffers on-GCD', () => {
    const sent: AbilityUseRequest[] = [];
    const controller = createController((request) => sent.push(request));
    const source = (controller as unknown as { source: MobEntity }).source;
    const abilityState = source.sync.abilityState as {
      castStartTimeMs: number;
      castEndTimeMs: number;
    };

    vi.useFakeTimers();
    vi.setSystemTime(1000);
    abilityState.castStartTimeMs = 900;
    abilityState.castEndTimeMs = 1100;

    controller.fixedTick();
    controller.tryUseAbility('quick_dart', { targetEntityId: 'player-1' });
    expect(sent).toHaveLength(0);

    controller.tryUseAbility('shield_bash', { targetEntityId: 'player-1' });
    expect(sent).toHaveLength(1);
    expect(controller.getPredictionState().queuedAbilityId).toBe('shield_bash');
    vi.useRealTimers();
  });

  it('clears queued ability on cancel', () => {
    const sent: AbilityUseRequest[] = [];
    const controller = createController((request) => sent.push(request));
    const prediction = controller.getPredictionState();

    prediction.queuedAbilityId = 'shield_bash';
    (prediction as unknown as { lastRequestId?: string }).lastRequestId = 'req-queued';

    controller.cancelActiveCast('movement');

    expect(prediction.queuedAbilityId).toBeUndefined();
  });

  it('applies ack timing and cooldown updates', () => {
    const controller = createController(() => {});
    const prediction = controller.getPredictionState();
    const ability = ABILITY_DEFINITIONS.shield_bash;

    vi.useFakeTimers();
    vi.setSystemTime(1000);
    prediction.markAbilityRequested(ability, 'req-1', 1, 1000);
    vi.setSystemTime(1200);

    const ack: AbilityAck = {
      type: 'ability_ack',
      requestId: 'req-1',
      sequence: 1,
      accepted: true,
      serverTimeMs: 1000,
      serverTick: 10,
      castStartTimeMs: 1000,
      castEndTimeMs: 1000,
      gcdStartTimeMs: 1000,
      gcdEndTimeMs: 3500,
      result: {
        abilityId: 'shield_bash',
        actorId: 'player-1',
        useCheck: { roll: 100, maxRoll: 100, result: 'success' },
        effects: [],
      },
    };

    controller.applyAck(ack);

    expect(prediction.predictedGcdEndTimeMs).toBe(3500);
    expect(prediction.predictedInternalCooldownEndTimeMs).toBe(1700);
    expect(prediction.getAbilityCooldownEndTime('shield_bash')).toBe(
      1000 + ABILITY_DEFINITIONS.shield_bash.cooldownMs
    );
    vi.useRealTimers();
  });

  it('ignores stale acks', () => {
    const controller = createController(() => {});
    const prediction = controller.getPredictionState();

    vi.useFakeTimers();
    vi.setSystemTime(2000);

    const ackNewest: AbilityAck = {
      type: 'ability_ack',
      requestId: 'req-2',
      sequence: 2,
      accepted: true,
      serverTimeMs: 2000,
      serverTick: 10,
      castStartTimeMs: 2000,
      castEndTimeMs: 2000,
      gcdStartTimeMs: 2000,
      gcdEndTimeMs: 4500,
      result: {
        abilityId: 'shield_bash',
        actorId: 'player-1',
        useCheck: { roll: 100, maxRoll: 100, result: 'success' },
        effects: [],
      },
    };

    const ackStale: AbilityAck = {
      type: 'ability_ack',
      requestId: 'req-1',
      sequence: 1,
      accepted: true,
      serverTimeMs: 1000,
      serverTick: 9,
      castStartTimeMs: 1000,
      castEndTimeMs: 1000,
      gcdStartTimeMs: 1000,
      gcdEndTimeMs: 3000,
      result: {
        abilityId: 'shield_bash',
        actorId: 'player-1',
        useCheck: { roll: 100, maxRoll: 100, result: 'success' },
        effects: [],
      },
    };

    controller.applyAck(ackNewest);
    vi.setSystemTime(2100);
    controller.applyAck(ackStale);

    expect(prediction.predictedGcdEndTimeMs).toBe(4500);
    vi.useRealTimers();
  });

  it('rolls back optimistic cooldowns on rejected acks', () => {
    const controller = createController(() => {});
    const prediction = controller.getPredictionState();
    const ability = ABILITY_DEFINITIONS.shield_bash;

    vi.useFakeTimers();
    vi.setSystemTime(1000);
    prediction.markAbilityRequested(ability, 'req-rollback', 1, 1000);
    vi.setSystemTime(1500);

    const ack: AbilityAck = {
      type: 'ability_ack',
      requestId: 'req-rollback',
      sequence: 1,
      accepted: false,
      serverTimeMs: 1000,
      serverTick: 10,
      castStartTimeMs: 0,
      castEndTimeMs: 0,
      rejectReason: 'out_of_range',
    };

    controller.applyAck(ack);

    expect(prediction.predictedGcdEndTimeMs).toBe(1500);
    expect(prediction.predictedInternalCooldownEndTimeMs).toBe(1500);
    expect(prediction.getAbilityCooldownEndTime('shield_bash')).toBe(1500);
    vi.useRealTimers();
  });
});
