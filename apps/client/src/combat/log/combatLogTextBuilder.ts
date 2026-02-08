/**
 * Combat log text builder.
 *
 * Approach:
 * - Pure, deterministic transformation of `EventLogEntry` → `CombatLogMessage`.
 * - Templates are centralized to keep localization and tone changes data-driven.
 * - Styling is encoded as structured `parts` so UI can color only the intended
 *   values (e.g., damage/heal numbers) without fragile string parsing.
 * - "You/Your" substitutions are handled here via `resolveSelfId`, so callers
 *   only need to supply entity/ability name resolvers.
 */
import {
  ABILITY_DEFINITIONS,
  CombatEventType,
  EventCategory,
  type AbilityCastFinishEvent,
  type AbilityCastInterruptEvent,
  type AbilityCastStartEvent,
  type AbilityEffectAppliedEvent,
  type EventLogEntry,
  type MobEnterCombatEvent,
  type MobExitCombatEvent,
} from "@mmo/shared";

export interface CombatLogTextContext {
  resolveEntityName(entityId: string): string;
  resolveAbilityName(abilityId: string): string;
  resolveSelfId?: () => string | undefined;
}

export type CombatLogMessageTone = "damage" | "healing";

export interface CombatLogMessagePart {
  /** Raw text for this segment. */
  text: string;
  /** Optional semantic tone for UI styling. */
  tone?: CombatLogMessageTone;
}

export interface CombatLogMessage {
  /** Full, concatenated text. */
  text: string;
  /** Ordered parts used by the UI to apply tone styling safely. */
  parts: CombatLogMessagePart[];
}

export type CombatLogTextBuilder = (
  entry: EventLogEntry,
  context: CombatLogTextContext,
) => CombatLogMessage | null;

type CombatTextRule = (
  entry: EventLogEntry,
  context: CombatLogTextContext,
) => CombatLogMessage | null;

const COMBAT_TEXT_TEMPLATES = {
  castStartSelf: "You begin casting {ability}.",
  castStartOther: "{actor} begins casting {ability}.",
  castFinishSelf: "You finish casting {ability}.",
  castFinishOther: "{actor} finishes casting {ability}.",
  castInterrupt: "{actorPossessive} {ability} was interrupted ({reason}).",
  effectDamageSelf: "You hit {target} with {ability} for {damage}.",
  effectDamageOther: "{actor} hits {target} with {ability} for {damage}.",
  effectCritDamageSelf:
    "You critically hit {target} with {ability} for {damage}.",
  effectCritDamageOther:
    "{actor} critically hits {target} with {ability} for {damage}.",
  effectHealingSelf: "You heal {target} for {healing}.",
  effectHealingOther: "{actor} heals {target} for {healing}.",
  effectMissSelf: "You miss {target} with {ability}.",
  effectMissOther: "{actor} misses {target} with {ability}.",
  effectBlockedHit:
    "{actorPossessive} {ability} hit {target} for {damage} (blocked: {blocked}).",
  effectDodged: "{target} dodges {actorPossessive} {ability}.",
  effectImmune: "{target} is immune to {actorPossessive} {ability}.",
  effectNoEffect: "{actorPossessive} {ability} has no effect on {target}.",
  enterCombat: "{mob} enters combat.",
  exitCombat: "{mob} leaves combat.",
} as const;

const COMBAT_TEXT_RULES: Partial<Record<CombatEventType, CombatTextRule>> = {
  [CombatEventType.AbilityCastStart]: (entry, context) =>
    buildCastStart(entry as AbilityCastStartEvent, context),
  [CombatEventType.AbilityCastFinish]: (entry, context) =>
    buildCastFinish(entry as AbilityCastFinishEvent, context),
  [CombatEventType.AbilityCastInterrupt]: (entry, context) =>
    buildCastInterrupt(entry as AbilityCastInterruptEvent, context),
  [CombatEventType.AbilityEffectApplied]: (entry, context) =>
    buildEffectApplied(entry as AbilityEffectAppliedEvent, context),
  [CombatEventType.MobEnterCombat]: (entry, context) =>
    buildMobEnter(entry as MobEnterCombatEvent, context),
  [CombatEventType.MobExitCombat]: (entry, context) =>
    buildMobExit(entry as MobExitCombatEvent, context),
};

/**
 * Build a combat log message from a single event entry.
 *
 * Returns `null` for non-combat events or unsupported event types.
 */
export const buildCombatLogText: CombatLogTextBuilder = (entry, context) => {
  if (entry.category !== EventCategory.Combat) {
    return null;
  }

  const rule = COMBAT_TEXT_RULES[entry.eventType as CombatEventType];
  if (!rule) {
    return null;
  }

  return rule(entry, context);
};

/**
 * Helper for creating a text context with sensible defaults.
 *
 * - `resolveAbilityName` falls back to `ABILITY_DEFINITIONS` lookup.
 * - `resolveSelfId` enables "You/Your" substitutions.
 */
export const createCombatLogTextContext = (
  resolveEntityName: (entityId: string) => string,
  resolveAbilityName?: (abilityId: string) => string,
  resolveSelfId?: () => string | undefined,
): CombatLogTextContext => {
  return {
    resolveEntityName,
    resolveAbilityName:
      resolveAbilityName ??
      ((abilityId) =>
        ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS]
          ?.name ?? abilityId),
    resolveSelfId,
  };
};

interface ActorDisplay {
  subject: string;
  possessive: string;
  isSelf: boolean;
}

const resolveActorDisplay = (
  actorId: string,
  context: CombatLogTextContext,
): ActorDisplay => {
  const selfId = context.resolveSelfId?.();
  if (selfId && actorId === selfId) {
    return { subject: "You", possessive: "Your", isSelf: true };
  }

  const name = context.resolveEntityName(actorId);
  return {
    subject: name,
    possessive: `${name}'s`,
    isSelf: false,
  };
};

type TemplateValue = string | number | CombatLogMessagePart;

/**
 * Wrap a numeric value with a semantic tone so UI can style it directly.
 */
const createToneValue = (
  value: number,
  tone: CombatLogMessageTone,
): CombatLogMessagePart => {
  return { text: String(value), tone };
};

const buildCastStart = (
  entry: AbilityCastStartEvent,
  context: CombatLogTextContext,
): CombatLogMessage => {
  const actor = resolveActorDisplay(entry.actorId, context);
  return formatTemplate(
    actor.isSelf
      ? COMBAT_TEXT_TEMPLATES.castStartSelf
      : COMBAT_TEXT_TEMPLATES.castStartOther,
    {
      actor: actor.subject,
      ability: context.resolveAbilityName(entry.abilityId),
    },
  );
};

const buildCastFinish = (
  entry: AbilityCastFinishEvent,
  context: CombatLogTextContext,
): CombatLogMessage => {
  const actor = resolveActorDisplay(entry.actorId, context);
  return formatTemplate(
    actor.isSelf
      ? COMBAT_TEXT_TEMPLATES.castFinishSelf
      : COMBAT_TEXT_TEMPLATES.castFinishOther,
    {
      actor: actor.subject,
      ability: context.resolveAbilityName(entry.abilityId),
    },
  );
};

const buildCastInterrupt = (
  entry: AbilityCastInterruptEvent,
  context: CombatLogTextContext,
): CombatLogMessage => {
  const actor = resolveActorDisplay(entry.actorId, context);
  return formatTemplate(COMBAT_TEXT_TEMPLATES.castInterrupt, {
    actorPossessive: actor.possessive,
    ability: context.resolveAbilityName(entry.abilityId),
    reason: entry.reason,
  });
};

const buildEffectApplied = (
  entry: AbilityEffectAppliedEvent,
  context: CombatLogTextContext,
): CombatLogMessage | null => {
  const actor = resolveActorDisplay(entry.actorId, context);
  const target = context.resolveEntityName(entry.targetId);
  const ability = context.resolveAbilityName(entry.abilityId);

  switch (entry.outcome) {
    case "miss":
      return formatTemplate(
        actor.isSelf
          ? COMBAT_TEXT_TEMPLATES.effectMissSelf
          : COMBAT_TEXT_TEMPLATES.effectMissOther,
        {
          actor: actor.subject,
          target,
          ability,
        },
      );
    case "dodged":
      return formatTemplate(COMBAT_TEXT_TEMPLATES.effectDodged, {
        actorPossessive: actor.possessive,
        target,
        ability,
      });
    case "immune":
      return formatTemplate(COMBAT_TEXT_TEMPLATES.effectImmune, {
        actorPossessive: actor.possessive,
        target,
        ability,
      });
    case "no_effect":
      return formatTemplate(COMBAT_TEXT_TEMPLATES.effectNoEffect, {
        actorPossessive: actor.possessive,
        target,
        ability,
      });
    default:
      break;
  }

  if (entry.damage !== undefined && entry.damage > 0) {
    if (
      entry.outcome === "blocked" &&
      entry.blockedAmount !== undefined &&
      entry.blockedAmount > 0
    ) {
      return formatTemplate(COMBAT_TEXT_TEMPLATES.effectBlockedHit, {
        actorPossessive: actor.possessive,
        target,
        ability,
        damage: createToneValue(entry.damage, "damage"),
        blocked: entry.blockedAmount,
      });
    }

    if (entry.outcome === "crit") {
      return formatTemplate(
        actor.isSelf
          ? COMBAT_TEXT_TEMPLATES.effectCritDamageSelf
          : COMBAT_TEXT_TEMPLATES.effectCritDamageOther,
        {
          actor: actor.subject,
          target,
          ability,
          damage: createToneValue(entry.damage, "damage"),
        },
      );
    }

    return formatTemplate(
      actor.isSelf
        ? COMBAT_TEXT_TEMPLATES.effectDamageSelf
        : COMBAT_TEXT_TEMPLATES.effectDamageOther,
      {
        actor: actor.subject,
        target,
        ability,
        damage: createToneValue(entry.damage, "damage"),
      },
    );
  }

  if (entry.healing !== undefined && entry.healing > 0) {
    return formatTemplate(
      actor.isSelf
        ? COMBAT_TEXT_TEMPLATES.effectHealingSelf
        : COMBAT_TEXT_TEMPLATES.effectHealingOther,
      {
        actor: actor.subject,
        target,
        ability,
        healing: createToneValue(entry.healing, "healing"),
      },
    );
  }

  return null;
};

const buildMobEnter = (
  entry: MobEnterCombatEvent,
  context: CombatLogTextContext,
): CombatLogMessage => {
  return formatTemplate(COMBAT_TEXT_TEMPLATES.enterCombat, {
    mob: context.resolveEntityName(entry.mobId),
  });
};

const buildMobExit = (
  entry: MobExitCombatEvent,
  context: CombatLogTextContext,
): CombatLogMessage => {
  return formatTemplate(COMBAT_TEXT_TEMPLATES.exitCombat, {
    mob: context.resolveEntityName(entry.mobId),
  });
};

/**
 * Formats a template into a structured message.
 *
 * Placeholders can be plain strings/numbers or `CombatLogMessagePart` to attach
 * tone metadata to specific segments (e.g., damage/healing numbers).
 */
const formatTemplate = (
  template: string,
  values: Record<string, TemplateValue>,
): CombatLogMessage => {
  const parts: CombatLogMessagePart[] = [];
  let text = "";
  let cursor = 0;
  const regex = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;

  const pushPart = (part: CombatLogMessagePart) => {
    if (!part.text) {
      return;
    }
    parts.push(part);
    text += part.text;
  };

  while ((match = regex.exec(template))) {
    const literal = template.slice(cursor, match.index);
    if (literal) {
      pushPart({ text: literal });
    }

    const key = match[1];
    const value = values[key];
    if (value === undefined) {
      pushPart({ text: match[0] });
    } else if (typeof value === "object") {
      pushPart(value);
    } else {
      pushPart({ text: String(value) });
    }

    cursor = match.index + match[0].length;
  }

  const tail = template.slice(cursor);
  if (tail) {
    pushPart({ text: tail });
  }

  return { text, parts };
};
