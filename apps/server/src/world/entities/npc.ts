import type { NPCState } from "@mmo/shared";
import { AggroTable } from "../../combat/aggroTable";
import { NpcAi } from "./npcAI";
import { ServerMob } from "./serverMob";

/**
 * Server-side AI state for an NPC.
 */
export interface NpcAiState {
  targetYaw: number;
  nextDecisionAtMs: number;
  movingUntilMs: number;
}

/**
 * Server-only NPC wrapper around synced state.
 */
export class ServerNPC extends ServerMob<NPCState> {
  public readonly npcAi: NpcAi;
  public readonly aggro: AggroTable;

  /**
   * Creates a new server NPC wrapper.
   *
   * @param synced - synced NPC state.
   */
  constructor(synced: NPCState) {
    super(synced);
    this.npcAi = new NpcAi(this);
    this.aggro = new AggroTable(synced.combatState);
  }
}
