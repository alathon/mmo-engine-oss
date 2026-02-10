import type { ChatViewModel } from './widgets/chat/chat-view-model';
import type { ConnectionStatusViewModel } from './widgets/connectionStatus/connection-status-view-model';
import type { HotbarViewModel } from './widgets/hotbars/hotbar-view-model';
import type { PerformanceViewModel } from './widgets/performance/performance-view-model';
import { ChatOverlay } from './widgets/chat/chat-overlay';
import { ConnectionStatusOverlay } from './widgets/connectionStatus/connection-status-overlay';
import { HotbarOverlay } from './widgets/hotbars/hotbar-overlay';
import { PerformanceOverlay } from './widgets/performance/performance-overlay';
import { UiLayoutControlsOverlay } from './widgets/layoutControls/ui-layout-controls-overlay';

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
      {performanceViewModel && <PerformanceOverlay viewModel={performanceViewModel} />}
      {connectionStatusViewModel && (
        <ConnectionStatusOverlay viewModel={connectionStatusViewModel} />
      )}
      {hotbarViewModel && <HotbarOverlay viewModel={hotbarViewModel} />}
      {chatViewModel && <ChatOverlay viewModel={chatViewModel} />}
      <UiLayoutControlsOverlay />
    </>
  );
};
