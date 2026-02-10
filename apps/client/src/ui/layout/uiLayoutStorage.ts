import { UI_LAYOUT_SCHEMA_VERSION } from "./uiLayoutDefaults";
import type { UiLayoutStore } from "./uiLayoutTypes";

/**
 * Prefix used for persisted layout storage keys.
 */
export const UI_LAYOUT_STORAGE_KEY_PREFIX = "mmo.ui.layouts.v1";

/**
 * Builds a localStorage key for a given player ID (or temporary storage).
 */
export const buildLayoutStorageKey = (playerId?: string): string =>
  `${UI_LAYOUT_STORAGE_KEY_PREFIX}.${playerId ?? "temp"}`;

export type ParseLayoutStoreResult =
  | { ok: true; store: UiLayoutStore }
  | { ok: false; error: string };

/**
 * Parses and validates a serialized layout store payload.
 */
export const parseLayoutStore = (raw: string): ParseLayoutStoreResult => {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: "Layout data is not valid JSON." };
  }

  if (!value || typeof value !== "object") {
    return { ok: false, error: "Layout data must be an object." };
  }

  const schemaVersion = Reflect.get(value, "schemaVersion");
  const activeLayoutId = Reflect.get(value, "activeLayoutId");
  const layouts = Reflect.get(value, "layouts");

  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
    return { ok: false, error: "Layout schemaVersion must be a number." };
  }

  if (typeof activeLayoutId !== "string") {
    return { ok: false, error: "Layout activeLayoutId must be a string." };
  }

  if (!Array.isArray(layouts)) {
    return { ok: false, error: "Layout layouts must be an array." };
  }

  return {
    ok: true,
    store: value as UiLayoutStore,
  };
};

/**
 * Migrates stored layout data to the latest schema version.
 */
export const migrateLayoutStore = (
  store: UiLayoutStore,
): UiLayoutStore | null => {
  if (store.schemaVersion === UI_LAYOUT_SCHEMA_VERSION) {
    return store;
  }

  if (store.schemaVersion > UI_LAYOUT_SCHEMA_VERSION) {
    return null;
  }

  const migrations: Record<number, (data: UiLayoutStore) => UiLayoutStore> = {
    0: (data) => ({ ...data, schemaVersion: 1 }),
  };

  let current = store;
  while (current.schemaVersion < UI_LAYOUT_SCHEMA_VERSION) {
    const migrate = migrations[current.schemaVersion];
    if (!migrate) {
      return null;
    }
    current = migrate(current);
  }

  return current;
};

/**
 * Serializes a layout store for export.
 */
export const serializeLayoutStore = (store: UiLayoutStore): string =>
  JSON.stringify(store, null, 2);
