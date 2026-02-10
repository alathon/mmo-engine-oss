import type { Scene } from '@babylonjs/core/scene';
import type { InputManager } from '../input/input-manager';
import { DomInputManager } from '../input/dom-input-manager';
import { GameUI } from '../ui/game-ui';
import { ZoneConnectionManager } from '../network/zone-connection-manager';
import { SocialNetworkManager } from '../network/social-network-manager';
import { ChatManager } from '../ui/widgets/chat/chat-manager';
import { ChatViewModel } from '../ui/widgets/chat/chat-view-model';
import { ConnectionStatusViewModel } from '../ui/widgets/connectionStatus/connection-status-view-model';
import { HotbarViewModel } from '../ui/widgets/hotbars/hotbar-view-model';
import { PerformanceViewModel } from '../ui/widgets/performance/performance-view-model';

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
