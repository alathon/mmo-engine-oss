import type { ChatViewModel } from "./widgets/chat/chatViewModel";
import type { ConnectionStatusViewModel } from "./widgets/connectionStatus/connectionStatusViewModel";
import type { HotbarViewModel } from "./widgets/hotbars/hotbarViewModel";
import type { PerformanceViewModel } from "./widgets/performance/performanceViewModel";
import { ChatOverlay } from "./widgets/chat/ChatOverlay";
import { ConnectionStatusOverlay } from "./widgets/connectionStatus/ConnectionStatusOverlay";
import { HotbarOverlay } from "./widgets/hotbars/HotbarOverlay";
import { PerformanceOverlay } from "./widgets/performance/PerformanceOverlay";
import { UiLayoutControlsOverlay } from "./widgets/layoutControls/UiLayoutControlsOverlay";

export interface IngameUiRootProps {
  chatViewModel?: ChatViewModel;
  connectionStatusViewModel?: ConnectionStatusViewModel;
  hotbarViewModel?: HotbarViewModel;
  performanceViewModel?: PerformanceViewModel;
}

export const IngameUiRoot = ({
  chatViewModel,
  connectionStatusViewModel,
  hotbarViewModel,
  performanceViewModel,
}: IngameUiRootProps) => {
  return (
    <>
      {performanceViewModel ? (
        <PerformanceOverlay viewModel={performanceViewModel} />
      ) : null}
      {connectionStatusViewModel ? (
        <ConnectionStatusOverlay viewModel={connectionStatusViewModel} />
      ) : null}
      {hotbarViewModel ? <HotbarOverlay viewModel={hotbarViewModel} /> : null}
      {chatViewModel ? <ChatOverlay viewModel={chatViewModel} /> : null}
      <UiLayoutControlsOverlay />
    </>
  );
};
