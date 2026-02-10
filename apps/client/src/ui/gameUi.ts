import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import type { BattleMessagePayload, ChatViewModel } from "./widgets/chat/chatViewModel";

/**
 * Manages the in-game UI layer (name labels, health bars, etc.)
 * Uses a fullscreen AdvancedDynamicTexture that UI elements can attach to.
 */
export class GameUI {
  public readonly texture: AdvancedDynamicTexture;
  private chatViewModel?: ChatViewModel;

  constructor(scene: Scene) {
    this.texture = AdvancedDynamicTexture.CreateFullscreenUI(
      "gameUI",
      true,
      scene,
    );
  }

  attachChatViewModel(viewModel: ChatViewModel): void {
    this.chatViewModel = viewModel;
  }

  appendBattleMessage(message: BattleMessagePayload): void {
    this.chatViewModel?.addBattleMessage(message);
  }

  disposeChatUi(): void {
    this.chatViewModel = undefined;
  }

  dispose(): void {
    this.disposeChatUi();
    this.texture.dispose();
  }
}
