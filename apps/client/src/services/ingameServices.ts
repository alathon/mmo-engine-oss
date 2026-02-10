import type { Scene } from "@babylonjs/core/scene";
import type { InputManager } from "../input/inputManager";
import { DomInputManager } from "../input/domInputManager";
import { GameUI } from "../ui/gameUi";
import { ZoneConnectionManager } from "../network/zoneConnectionManager";
import { SocialNetworkManager } from "../network/socialNetworkManager";
import { ChatManager } from "../ui/widgets/chat/chatManager";
import { ChatViewModel } from "../ui/widgets/chat/chatViewModel";
import { ConnectionStatusViewModel } from "../ui/widgets/connectionStatus/connectionStatusViewModel";
import { HotbarViewModel } from "../ui/widgets/hotbars/hotbarViewModel";
import { PerformanceViewModel } from "../ui/widgets/performance/performanceViewModel";

export interface IngameServices {
  input: InputManager;
  ui: GameUI;
  zoneNetwork: ZoneConnectionManager;
  socialNetwork: SocialNetworkManager;
  chat: ChatManager;
  chatViewModel: ChatViewModel;
  connectionStatusViewModel: ConnectionStatusViewModel;
  hotbarViewModel: HotbarViewModel;
  performanceViewModel: PerformanceViewModel;
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
  const performanceViewModel = new PerformanceViewModel(scene, zoneNetwork);

  return {
    input,
    ui,
    zoneNetwork,
    socialNetwork,
    chat,
    chatViewModel,
    connectionStatusViewModel,
    hotbarViewModel,
    performanceViewModel,
  };
};
