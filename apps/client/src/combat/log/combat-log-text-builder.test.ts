import { describe, expect, it } from 'vitest';
import {
  CombatEventType,
  EventCategory,
  type AbilityCastFinishEvent,
  type AbilityCastInterruptEvent,
  type AbilityCastStartEvent,
  type AbilityEffectAppliedEvent,
  type EventLogEntry,
  type MobEnterCombatEvent,
  type MobExitCombatEvent,
} from '@mmo/shared';
import { buildCombatLogText, createCombatLogTextContext } from './combat-log-text-builder';

const context = createCombatLogTextContext(
  (id) => ({ p1: 'Ayla', m1: 'Goblin' })[id] ?? id,
  (id) => ({ shield_bash: 'Shield Bash', quick_dart: 'Quick Dart' })[id] ?? id
);
const selfContext = createCombatLogTextContext(
  (id) => ({ p1: 'Ayla', m1: 'Goblin' })[id] ?? id,
  (id) => ({ shield_bash: 'Shield Bash', quick_dart: 'Quick Dart' })[id] ?? id,
  () => 'p1'
);

const baseEntry = (): Omit<EventLogEntry, 'eventType' | 'category'> => ({
  eventId: 1,
  serverTick: 10,
  serverTimeMs: 1000,
});

describe('CombatLogTextBuilder', () => {
  it('formats cast lifecycle text', () => {
    const castStart: AbilityCastStartEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityCastStart,
      actorId: 'p1',
      castId: 1,
      abilityId: 'shield_bash',
      target: { targetEntityId: 'm1' },
      castStartTimeMs: 1000,
      castEndTimeMs: 1200,
    };

    const castFinish: AbilityCastFinishEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityCastFinish,
      actorId: 'p1',
      castId: 1,
      abilityId: 'shield_bash',
    };

    expect(buildCombatLogText(castStart, context)?.text).toBe('Ayla begins casting Shield Bash.');
    expect(buildCombatLogText(castFinish, context)?.text).toBe(
      'Ayla finishes casting Shield Bash.'
    );
  });

  it('formats interrupts', () => {
    const interrupt: AbilityCastInterruptEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityCastInterrupt,
      actorId: 'p1',
      castId: 2,
      abilityId: 'quick_dart',
      reason: 'movement',
    };

    expect(buildCombatLogText(interrupt, context)?.text).toBe(
      "Ayla's Quick Dart was interrupted (movement)."
    );
  });

  it('uses You/Your when the actor is the local player', () => {
    const castStart: AbilityCastStartEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityCastStart,
      actorId: 'p1',
      castId: 1,
      abilityId: 'shield_bash',
      target: { targetEntityId: 'm1' },
      castStartTimeMs: 1000,
      castEndTimeMs: 1200,
    };

    const damage: AbilityEffectAppliedEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityEffectApplied,
      actorId: 'p1',
      castId: 3,
      abilityId: 'quick_dart',
      effectId: 0,
      targetId: 'm1',
      outcome: 'crit',
      damage: 30,
    };

    const dodged: AbilityEffectAppliedEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityEffectApplied,
      actorId: 'p1',
      castId: 4,
      abilityId: 'quick_dart',
      effectId: 1,
      targetId: 'm1',
      outcome: 'dodged',
    };

    expect(buildCombatLogText(castStart, selfContext)?.text).toBe('You begin casting Shield Bash.');
    expect(buildCombatLogText(damage, selfContext)?.text).toBe(
      'You critically hit Goblin with Quick Dart for 30.'
    );
    expect(buildCombatLogText(dodged, selfContext)?.text).toBe('Goblin dodges Your Quick Dart.');
  });

  it('formats damage and healing effects', () => {
    const damage: AbilityEffectAppliedEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityEffectApplied,
      actorId: 'p1',
      castId: 3,
      abilityId: 'shield_bash',
      effectId: 0,
      targetId: 'm1',
      outcome: 'hit',
      damage: 42,
    };

    const critDamage: AbilityEffectAppliedEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityEffectApplied,
      actorId: 'p1',
      castId: 3,
      abilityId: 'shield_bash',
      effectId: 0,
      targetId: 'm1',
      outcome: 'crit',
      damage: 58,
    };

    const healing: AbilityEffectAppliedEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityEffectApplied,
      actorId: 'p1',
      castId: 4,
      abilityId: 'shield_bash',
      effectId: 1,
      targetId: 'p1',
      outcome: 'hit',
      healing: 18,
    };

    const damageMessage = buildCombatLogText(damage, context);
    expect(damageMessage?.text).toBe('Ayla hits Goblin with Shield Bash for 42.');
    expect(damageMessage?.parts.some((part) => part.tone === 'damage')).toBe(true);

    const critMessage = buildCombatLogText(critDamage, context);
    expect(critMessage?.text).toBe('Ayla critically hits Goblin with Shield Bash for 58.');
    expect(critMessage?.parts.some((part) => part.tone === 'damage')).toBe(true);

    const healingMessage = buildCombatLogText(healing, context);
    expect(healingMessage?.text).toBe('Ayla heals Ayla for 18.');
    expect(healingMessage?.parts.some((part) => part.tone === 'healing')).toBe(true);
  });

  it('formats miss, blocked, dodged, immune, and no-effect outcomes', () => {
    const base: Omit<AbilityEffectAppliedEvent, 'outcome' | 'damage' | 'healing'> = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.AbilityEffectApplied,
      actorId: 'p1',
      castId: 5,
      abilityId: 'quick_dart',
      effectId: 2,
      targetId: 'm1',
    };

    const makeOutcome = (
      outcome: AbilityEffectAppliedEvent['outcome']
    ): AbilityEffectAppliedEvent => ({
      ...base,
      outcome,
    });

    expect(buildCombatLogText(makeOutcome('miss'), context)?.text).toBe(
      'Ayla misses Goblin with Quick Dart.'
    );
    const blocked: AbilityEffectAppliedEvent = {
      ...base,
      outcome: 'blocked',
      damage: 12,
      blockedAmount: 4,
    };
    expect(buildCombatLogText(blocked, context)?.text).toBe(
      "Ayla's Quick Dart hit Goblin for 12 (blocked: 4)."
    );
    expect(buildCombatLogText(makeOutcome('dodged'), context)?.text).toBe(
      "Goblin dodges Ayla's Quick Dart."
    );
    expect(buildCombatLogText(makeOutcome('immune'), context)?.text).toBe(
      "Goblin is immune to Ayla's Quick Dart."
    );
    expect(buildCombatLogText(makeOutcome('no_effect'), context)?.text).toBe(
      "Ayla's Quick Dart has no effect on Goblin."
    );
  });

  it('formats combat state changes', () => {
    const enter: MobEnterCombatEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.MobEnterCombat,
      mobId: 'm1',
      reason: 'aggro',
    };

    const exit: MobExitCombatEvent = {
      ...baseEntry(),
      category: EventCategory.Combat,
      eventType: CombatEventType.MobExitCombat,
      mobId: 'm1',
      reason: 'timeout',
    };

    expect(buildCombatLogText(enter, context)?.text).toBe('Goblin enters combat.');
    expect(buildCombatLogText(exit, context)?.text).toBe('Goblin leaves combat.');
  });

  it('ignores non-combat events', () => {
    const entry: EventLogEntry = {
      ...baseEntry(),
      category: EventCategory.Social,
      eventType: 1,
    };

    expect(buildCombatLogText(entry, context)).toBeUndefined();
  });
});
