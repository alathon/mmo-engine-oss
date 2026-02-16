import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { NavmeshTuningViewModel } from "./navmesh-tuning-view-model";
import { useWidgetLayout } from "../../layout/use-widget-layout";

const useNavmeshSnapshot = (viewModel: NavmeshTuningViewModel) => {
  const subscribe = useCallback(
    (listener: () => void) => viewModel.subscribe(listener),
    [viewModel],
  );
  const getSnapshot = useCallback(() => viewModel.getSnapshot(), [viewModel]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

interface FieldProps {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

const NumberField = ({ label, value, step, min, max, onChange }: FieldProps) => {
  return (
    <label className="navmesh-tuning__field">
      <span className="navmesh-tuning__label">{label}</span>
      <input
        className="navmesh-tuning__input"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) {
            return;
          }
          onChange(next);
        }}
      />
    </label>
  );
};

export const NavmeshTuningOverlay = ({ viewModel }: { viewModel: NavmeshTuningViewModel }) => {
  const snapshot = useNavmeshSnapshot(viewModel);
  const { style, dragHandlers } = useWidgetLayout("hud.navmeshTuning");
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | undefined>();

  const settings = snapshot.settings;
  const disabled = snapshot.busy;
  const snapToggleClass = snapshot.ignoreServerSnaps
    ? "navmesh-tuning__button navmesh-tuning__button--active"
    : "navmesh-tuning__button navmesh-tuning__button--ghost";
  const stopDrag = useCallback((event: ReactPointerEvent) => {
    event.stopPropagation();
  }, []);

  const handleExport = useCallback(async () => {
    const payload = {
      navmeshGeneration: snapshot.settings,
    };
    const json = JSON.stringify(payload, null, 2);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = json;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopyStatus("Copied navmesh settings.");
    } catch (error) {
      setCopyStatus(`Copy failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [snapshot.settings]);

  const stats = useMemo(() => {
    if (!snapshot.lastResult) {
      return "No preview yet.";
    }
    const { vertices, polys, durationMs } = snapshot.lastResult;
    return `Verts ${vertices} | Polys ${polys} | ${durationMs.toFixed(1)} ms`;
  }, [snapshot.lastResult]);

  return (
    <div id="navmesh-tuning-widget" data-ui-interactive="true" style={style} {...dragHandlers}>
      <div className="navmesh-tuning__header">
        <div className="navmesh-tuning__title">Navmesh Tuning</div>
        <button
          className="navmesh-tuning__toggle"
          type="button"
          onPointerDown={stopDrag}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <>
          <div className="navmesh-tuning__fields">
            <NumberField
              label="Cell Size"
              value={settings.cellSize}
              step={0.05}
              min={0.05}
              onChange={(value) => viewModel.updateSettings({ cellSize: value })}
            />
            <NumberField
              label="Cell Height"
              value={settings.cellHeight}
              step={0.05}
              min={0.05}
              onChange={(value) => viewModel.updateSettings({ cellHeight: value })}
            />
            <NumberField
              label="Walkable Radius"
              value={settings.walkableRadiusWorld}
              step={0.1}
              min={0}
              onChange={(value) => viewModel.updateSettings({ walkableRadiusWorld: value })}
            />
            <NumberField
              label="Walkable Height"
              value={settings.walkableHeightWorld}
              step={0.1}
              min={0.1}
              onChange={(value) => viewModel.updateSettings({ walkableHeightWorld: value })}
            />
            <NumberField
              label="Walkable Climb"
              value={settings.walkableClimbWorld}
              step={0.1}
              min={0}
              onChange={(value) => viewModel.updateSettings({ walkableClimbWorld: value })}
            />
            <NumberField
              label="Walkable Slope"
              value={settings.walkableSlopeAngleDegrees}
              step={1}
              min={0}
              max={90}
              onChange={(value) => viewModel.updateSettings({ walkableSlopeAngleDegrees: value })}
            />
            <NumberField
              label="Min Region Area"
              value={settings.minRegionArea}
              step={1}
              min={0}
              onChange={(value) => viewModel.updateSettings({ minRegionArea: value })}
            />
            <NumberField
              label="Merge Region Area"
              value={settings.mergeRegionArea}
              step={1}
              min={0}
              onChange={(value) => viewModel.updateSettings({ mergeRegionArea: value })}
            />
            <NumberField
              label="Simplification Error"
              value={settings.maxSimplificationError}
              step={0.1}
              min={0.1}
              onChange={(value) => viewModel.updateSettings({ maxSimplificationError: value })}
            />
            <NumberField
              label="Max Edge Length"
              value={settings.maxEdgeLength}
              step={1}
              min={1}
              onChange={(value) => viewModel.updateSettings({ maxEdgeLength: value })}
            />
            <NumberField
              label="Vertices Per Poly"
              value={settings.maxVerticesPerPoly}
              step={1}
              min={3}
              max={12}
              onChange={(value) => viewModel.updateSettings({ maxVerticesPerPoly: value })}
            />
            <NumberField
              label="Detail Sample Dist"
              value={settings.detailSampleDistanceVoxels}
              step={1}
              min={0}
              onChange={(value) => viewModel.updateSettings({ detailSampleDistanceVoxels: value })}
            />
            <NumberField
              label="Detail Sample Error"
              value={settings.detailSampleMaxErrorVoxels}
              step={0.5}
              min={0}
              onChange={(value) => viewModel.updateSettings({ detailSampleMaxErrorVoxels: value })}
            />
            <NumberField
              label="Subdiv Scale"
              value={settings.navmeshSubdivisionsScale ?? 0.25}
              step={0.05}
              min={0.05}
              max={1}
              onChange={(value) => viewModel.updateSettings({ navmeshSubdivisionsScale: value })}
            />
            <NumberField
              label="Border Size"
              value={settings.borderSize ?? 0}
              step={1}
              min={0}
              onChange={(value) => viewModel.updateSettings({ borderSize: value })}
            />
          </div>

          <div className="navmesh-tuning__actions">
            <button
              className={snapToggleClass}
              type="button"
              onPointerDown={stopDrag}
              onClick={() => viewModel.setIgnoreServerSnaps(!snapshot.ignoreServerSnaps)}
            >
              {snapshot.ignoreServerSnaps ? "Ignoring Server Snaps" : "Apply Server Snaps"}
            </button>
            <button
              className="navmesh-tuning__button"
              type="button"
              disabled={disabled}
              onPointerDown={stopDrag}
              onClick={() => viewModel.generate()}
            >
              {disabled ? "Generating..." : "Regenerate"}
            </button>
            <button
              className="navmesh-tuning__button navmesh-tuning__button--ghost"
              type="button"
              disabled={disabled}
              onPointerDown={stopDrag}
              onClick={handleExport}
            >
              Export JSON
            </button>
            <button
              className="navmesh-tuning__button navmesh-tuning__button--ghost"
              type="button"
              disabled={disabled}
              onPointerDown={stopDrag}
              onClick={() => viewModel.resetToDefaults()}
            >
              Reset Defaults
            </button>
          </div>

          <div className="navmesh-tuning__footer">
            <div className="navmesh-tuning__stats">{stats}</div>
            {snapshot.lastError && (
              <div className="navmesh-tuning__error">{snapshot.lastError}</div>
            )}
            {copyStatus && <div className="navmesh-tuning__stats">{copyStatus}</div>}
          </div>
        </>
      )}
    </div>
  );
};
