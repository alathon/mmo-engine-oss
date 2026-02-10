import type { NPCState } from "@mmo/shared";
import { AggroTable } from "../../combat/aggro-table";
import type { AbilityIntent } from "../../ai/components/ability-intent";
import type { BehaviorIntent } from "../../ai/components/behavior-intent";
import type { CombatAwareness } from "../../ai/components/combat-awareness";
import type { NpcBrainState } from "../../ai/components/npc-brain-state";
import type { SteeringIntent } from "../../ai/components/steering-intent";
import type { TargetSelection } from "../../ai/components/target-selection";
import { DEFAULT_NPC_AI_CONFIG, type NpcAiConfig } from "../constants/ai";
import { ServerMob } from "./server-mob";

/**
 * Server-only NPC wrapper around synced state.
 */
export class ServerNPC extends ServerMob<NPCState> {
  public readonly aggro: AggroTable;
  public readonly brainState: NpcBrainState;
  public readonly combatAwareness: CombatAwareness;
  public readonly targetSelection: TargetSelection;
  public readonly behaviorIntent: BehaviorIntent;
  public readonly steeringIntent: SteeringIntent;
  public readonly abilityIntent: AbilityIntent;
  public readonly aiConfig: NpcAiConfig;

  /**
   * Creates a new server NPC wrapper.
   *
   * @param synced - synced NPC state.
   */
  constructor(synced: NPCState) {
    super(synced);
    this.aggro = new AggroTable(synced.combatState);
    this.aiConfig = { ...DEFAULT_NPC_AI_CONFIG };
    this.brainState = {
      targetYaw: 0,
      nextDecisionAtMs: 0,
      movingUntilMs: 0,
      elapsedTimeMs: 0,
      chaseTargetId: undefined,
      chaseTargetX: 0,
      chaseTargetZ: 0,
      chasePath: [],
      chasePathIndex: 0,
      lastRepathAtMs: -Infinity,
    };
    this.combatAwareness = {
      topAggroTargetId: undefined,
      inCombat: false,
    };
    this.targetSelection = {
      targetId: undefined,
      targetX: 0,
      targetZ: 0,
      targetYaw: 0,
    };
    this.behaviorIntent = {
      mode: "idle",
      desiredRange: 0,
      moveUntilMs: 0,
    };
    this.steeringIntent = {
      directionX: 0,
      directionZ: 0,
      facingYaw: synced.facingYaw ?? 0,
    };
    this.abilityIntent = {
      abilityId: undefined,
      targetId: undefined,
      requestedAtMs: 0,
    };
  }
}
