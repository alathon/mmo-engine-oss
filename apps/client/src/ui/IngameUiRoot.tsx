import type { ChatViewModel } from "./chat/chatViewModel";
import type { ConnectionStatusViewModel } from "./connectionStatus/connectionStatusViewModel";
import type { HotbarViewModel } from "./hotbars/hotbarViewModel";
import { ChatOverlay } from "./chat/ChatOverlay";
import { ConnectionStatusOverlay } from "./connectionStatus/ConnectionStatusOverlay";
import { HotbarOverlay } from "./hotbars/HotbarOverlay";

export interface IngameUiRootProps {
  chatViewModel?: ChatViewModel;
  connectionStatusViewModel?: ConnectionStatusViewModel;
  hotbarViewModel?: HotbarViewModel;
}

export const IngameUiRoot = ({
  chatViewModel,
  connectionStatusViewModel,
  hotbarViewModel,
}: IngameUiRootProps) => {
  return (
    <>
      {connectionStatusViewModel ? (
        <ConnectionStatusOverlay viewModel={connectionStatusViewModel} />
      ) : null}
      {hotbarViewModel ? <HotbarOverlay viewModel={hotbarViewModel} /> : null}
      {chatViewModel ? <ChatOverlay viewModel={chatViewModel} /> : null}
    </>
  );
};
