import { describe, expect, it } from "vitest";
import { GameWorld } from "./game-world";
import type { IngameServices } from "../services/ingame-services";
import { ClientSession } from "../state/client-session";

describe("GameWorld", () => {
  it("constructs with mocked services", () => {
    const services: IngameServices = {
      input: {} as IngameServices["input"],
      ui: {} as IngameServices["ui"],
      zoneNetwork: {} as IngameServices["zoneNetwork"],
      socialNetwork: {} as IngameServices["socialNetwork"],
      chat: {} as IngameServices["chat"],
      chatViewModel: {} as IngameServices["chatViewModel"],
      connectionStatusViewModel: {} as IngameServices["connectionStatusViewModel"],
      hotbarViewModel: {} as IngameServices["hotbarViewModel"],
      navmeshTuningViewModel: {} as IngameServices["navmeshTuningViewModel"],
      performanceViewModel: {} as IngameServices["performanceViewModel"],
      clock: { nowMs: () => 0 },
    };

    const session = new ClientSession();
    const world = new GameWorld(services, session);

    expect(world).toBeDefined();
  });
});
