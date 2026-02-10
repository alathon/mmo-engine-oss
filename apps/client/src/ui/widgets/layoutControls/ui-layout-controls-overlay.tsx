import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';
import { uiLayoutManager, type UiLayoutImportMode } from '../../layout/ui-layout-manager';

const useLayoutSnapshot = () => {
  const subscribe = useCallback((listener: () => void) => uiLayoutManager.subscribe(listener), []);
  const getSnapshot = useCallback(() => uiLayoutManager.getSnapshot(), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

const isUiInputFocused = (): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }

  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return false;
  }

  return !!active.closest('[data-ui-input]');
};

/**
 * Minimal overlay for saving/exporting/importing UI layouts.
 */
export const UiLayoutControlsOverlay = () => {
  const snapshot = useLayoutSnapshot();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<UiLayoutImportMode>('replace');
  const uiLocked = snapshot.uiLocked;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();

      if (isUiInputFocused()) {
        return;
      }

      if (key === 'l') {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      if (key === 'u') {
        event.preventDefault();
        const locked = uiLayoutManager.toggleUiLocked();
        setStatus(locked ? 'UI locked.' : 'UI unlocked.');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const layoutOptions = useMemo(
    () => snapshot.layouts.map((layout) => ({ id: layout.id, name: layout.name })),
    [snapshot.layouts]
  );

  const handleActiveLayoutChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    uiLayoutManager.setActiveLayoutId(event.target.value);
    setStatus(undefined);
  }, []);

  const handleSave = useCallback(() => {
    const result = uiLayoutManager.saveToStorage();
    setStatus(result.ok ? 'Layouts saved.' : (result.error ?? 'Save failed.'));
  }, []);

  const handleToggleLock = useCallback(() => {
    const locked = uiLayoutManager.toggleUiLocked();
    setStatus(locked ? 'UI locked.' : 'UI unlocked.');
  }, []);

  const handleReset = useCallback(() => {
    uiLayoutManager.resetToDefaultLayout();
    setStatus('Reset to default (remember to save).');
  }, []);

  const handleExport = useCallback(() => {
    const json = uiLayoutManager.exportStore();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mmo-ui-layouts-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Exported layouts.');
  }, []);

  const handleImport = useCallback(() => {
    const result = uiLayoutManager.importFromJson(importText, importMode);
    if (!result.ok) {
      setStatus(result.error ?? 'Import failed.');
      return;
    }

    setStatus('Layouts imported.');
  }, [importMode, importText]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  if (!open) {
    return;
  }

  return (
    <div id="ui-layout-controls" data-ui-interactive="true">
      <div className="ui-layout-controls__header">
        <div>
          <div className="ui-layout-controls__title">UI Layouts</div>
          <div className="ui-layout-controls__subtitle">Toggle: L · Lock: U</div>
        </div>
        <button className="ui-layout-controls__close" type="button" onClick={handleClose}>
          Close
        </button>
      </div>

      <div className="ui-layout-controls__section">
        <label className="ui-layout-controls__label" htmlFor="layout-select">
          Active Layout
        </label>
        <select
          id="layout-select"
          className="ui-layout-controls__select"
          data-ui-input="true"
          value={snapshot.activeLayoutId}
          onChange={handleActiveLayoutChange}
        >
          {layoutOptions.map((layout) => (
            <option key={layout.id} value={layout.id}>
              {layout.name}
            </option>
          ))}
        </select>
      </div>

      <div className="ui-layout-controls__actions">
        <button type="button" onClick={handleSave}>
          Save Layout
        </button>
        <button type="button" onClick={handleToggleLock}>
          {uiLocked ? 'Unlock UI' : 'Lock UI'}
        </button>
        <button type="button" onClick={handleReset}>
          Reset to Default
        </button>
        <button type="button" onClick={handleExport}>
          Export Layouts
        </button>
      </div>

      <div className="ui-layout-controls__section">
        <label className="ui-layout-controls__label" htmlFor="layout-import">
          Import JSON
        </label>
        <textarea
          id="layout-import"
          className="ui-layout-controls__textarea"
          data-ui-input="true"
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="Paste layout JSON here"
          rows={6}
        />
        <div className="ui-layout-controls__import-row">
          <select
            className="ui-layout-controls__select"
            data-ui-input="true"
            value={importMode}
            onChange={(event) => setImportMode(event.target.value as UiLayoutImportMode)}
          >
            <option value="replace">Replace</option>
            <option value="merge">Merge</option>
          </select>
          <button type="button" onClick={handleImport}>
            Import Layouts
          </button>
        </div>
      </div>

      {status && <div className="ui-layout-controls__status">{status}</div>}
    </div>
  );
};
