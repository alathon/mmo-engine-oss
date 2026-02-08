import { useCallback, useSyncExternalStore } from "react";
import type { ConnectionStatusViewModel } from "./connectionStatusViewModel";

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
  const statusClass = status.connected ? "connected" : "disconnected";

  return (
    <div
      id="connection-status"
      className={statusClass}
      data-ui-interactive="true"
    >
      {status.text}
    </div>
  );
};
