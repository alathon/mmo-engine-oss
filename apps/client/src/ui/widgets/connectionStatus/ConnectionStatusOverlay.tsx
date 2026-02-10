import { useCallback, useSyncExternalStore } from "react";
import type { ConnectionStatusViewModel } from "./connectionStatusViewModel";
import { useWidgetLayout } from "../../layout/useWidgetLayout";

const useConnectionStatus = (viewModel: ConnectionStatusViewModel) => {
  const subscribe = useCallback(
    (listener: () => void) => viewModel.subscribe(listener),
    [viewModel],
  );
  const getSnapshot = useCallback(() => viewModel.getSnapshot(), [viewModel]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const ConnectionStatusOverlay = ({
  viewModel,
}: {
  viewModel: ConnectionStatusViewModel;
}) => {
  const status = useConnectionStatus(viewModel);
  const { style, dragHandlers } = useWidgetLayout("hud.connectionStatus");
  const statusClass = status.connected ? "connected" : "disconnected";

  return (
    <div
      id="connection-status"
      className={statusClass}
      data-ui-interactive="true"
      style={style}
      {...dragHandlers}
    >
      {status.text}
    </div>
  );
};
