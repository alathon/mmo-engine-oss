import type { Scene } from "@babylonjs/core/scene";
import type { InputManager } from "../input/inputManager";
import { DomInputManager } from "../input/domInputManager";
import { GameUI } from "../ui/gameUi";
import { ZoneConnectionManager } from "../network/zoneConnectionManager";
import { SocialNetworkManager } from "../network/socialNetworkManager";
import { ChatManager } from "../ui/chat/chatManager";
import { ChatViewModel } from "../ui/chat/chatViewModel";
import { ConnectionStatusViewModel } from "../ui/connectionStatus/connectionStatusViewModel";
import { HotbarViewModel } from "../ui/hotbars/hotbarViewModel";

export interface IngameServices {
  input: InputManager;
  ui: GameUI;
  zoneNetwork: ZoneConnectionManager;
  socialNetwork: SocialNetworkManager;
  chat: ChatManager;
  chatViewModel: ChatViewModel;
  connectionStatusViewModel: ConnectionStatusViewModel;
  hotbarViewModel: HotbarViewModel;
}

export const createIngameServices = (scene: Scene): IngameServices => {
  const input = new DomInputManager();
  const ui = new GameUI(scene);
  const zoneNetwork = new ZoneConnectionManager();
  const socialNetwork = new SocialNetworkManager();
  const chat = new ChatManager(socialNetwork);
  const chatViewModel = new ChatViewModel(chat);
  const connectionStatusViewModel = new ConnectionStatusViewModel(zoneNetwork);
  const hotbarViewModel = new HotbarViewModel();

  return {
    input,
    ui,
    zoneNetwork,
    socialNetwork,
    chat,
    chatViewModel,
    connectionStatusViewModel,
    hotbarViewModel,
  };
};
