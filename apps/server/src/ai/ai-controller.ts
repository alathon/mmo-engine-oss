import type { MobState } from "@mmo/shared";
import type { ServerMob } from "../world/entities/server-mob";
import type { ServerZone } from "../world/zones/zone";
import { AiDecisionSystem } from "./systems/ai-decision-system";
import { AiSensingSystem } from "./systems/ai-sensing-system";
import { AiSteeringSystem } from "./systems/ai-steering-system";
import { AiTargetSelectionSystem } from "./systems/ai-target-selection-system";

export class AiController {
  private readonly sensingSystem = new AiSensingSystem();
  private readonly targetSelectionSystem = new AiTargetSelectionSystem();
  private readonly decisionSystem = new AiDecisionSystem();
  private readonly steeringSystem = new AiSteeringSystem();
  private readonly combatantsBuffer: ServerMob<MobState>[] = [];

  constructor(private readonly zone: ServerZone) {}

  fixedTick(tickMs: number): void {
    this.advanceElapsedTime(tickMs);
    const combatants = this.collectCombatants();

    this.sensingSystem.update(this.zone);
    this.targetSelectionSystem.update(this.zone, combatants);
    this.decisionSystem.update(this.zone);
    this.steeringSystem.update(this.zone, this.zone.zoneData.navmeshQuery);
  }

  private advanceElapsedTime(tickMs: number): void {
    for (const npc of this.zone.npcs.values()) {
      npc.brainState.elapsedTimeMs += tickMs;
    }
  }

  private collectCombatants(): ServerMob<MobState>[] {
    const combatants = this.combatantsBuffer;
    combatants.length = 0;
    for (const player of this.zone.players.values()) {
      combatants.push(player);
    }
    for (const npc of this.zone.npcs.values()) {
      combatants.push(npc);
    }
    return combatants;
  }
}
