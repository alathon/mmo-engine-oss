import type { AbilityDefinition, AbilityResult, MobState } from "@mmo/shared";
import type { ServerMob } from "../world/entities/server-mob";

/** Emitted after an ability's results have been applied. */
export interface AbilityResolvedEvent {
  type: "ability_resolved";
  ability: AbilityDefinition;
  actor: ServerMob<MobState>;
  result: AbilityResult;
  resolvedAtMs: number;
}

/** AbilityEngine event union. */
export type AbilityEvent = AbilityResolvedEvent;

/** Listener interface for receiving AbilityEngine events. */
export interface AbilityEventListener {
  onAbilityEvent(event: AbilityEvent): void;
}
