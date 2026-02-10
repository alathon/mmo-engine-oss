import { describe, expect, it } from "vitest";
import { GameWorld } from "./gameWorld";
import type { IngameServices } from "../services/ingameServices";
import { ClientSession } from "../state/clientSession";

describe("GameWorld", () => {
  it("constructs with mocked services", () => {
    const services: IngameServices = {
      input: {} as IngameServices["input"],
      ui: {} as IngameServices["ui"],
      zoneNetwork: {} as IngameServices["zoneNetwork"],
      socialNetwork: {} as IngameServices["socialNetwork"],
      chat: {} as IngameServices["chat"],
      chatViewModel: {} as IngameServices["chatViewModel"],
      connectionStatusViewModel:
        {} as IngameServices["connectionStatusViewModel"],
      hotbarViewModel: {} as IngameServices["hotbarViewModel"],
      performanceViewModel: {} as IngameServices["performanceViewModel"],
    };

    const session = new ClientSession();
    const world = new GameWorld(services, session);

    expect(world).toBeDefined();
  });
});
