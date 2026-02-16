import { useCallback, useSyncExternalStore } from "react";
import type { PerformanceViewModel } from "./performance-view-model";
import { useWidgetLayout } from "../../layout/use-widget-layout";

const usePerformanceSnapshot = (viewModel: PerformanceViewModel) => {
  const subscribe = useCallback(
    (listener: () => void) => viewModel.subscribe(listener),
    [viewModel],
  );
  const getSnapshot = useCallback(() => viewModel.getSnapshot(), [viewModel]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const PerformanceOverlay = ({ viewModel }: { viewModel: PerformanceViewModel }) => {
  const snapshot = usePerformanceSnapshot(viewModel);
  const { style, dragHandlers } = useWidgetLayout("hud.performance");

  const fpsText = snapshot.fps && snapshot.fps > 0 ? snapshot.fps : "--";
  const pingText = snapshot.pingMs === undefined ? "--" : `${snapshot.pingMs} ms`;

  return (
    <div id="performance-widget" data-ui-interactive="true" style={style} {...dragHandlers}>
      <div className="performance-widget__row">
        <span className="performance-widget__label">FPS</span>
        <span className="performance-widget__value">{fpsText}</span>
      </div>
      <div className="performance-widget__row">
        <span className="performance-widget__label">Ping</span>
        <span className="performance-widget__value">{pingText}</span>
      </div>
    </div>
  );
};
