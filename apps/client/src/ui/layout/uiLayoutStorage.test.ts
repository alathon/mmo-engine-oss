import { describe, expect, it } from "vitest";
import { UI_LAYOUT_SCHEMA_VERSION, createDefaultLayout } from "./uiLayoutDefaults";
import {
  migrateLayoutStore,
  parseLayoutStore,
  serializeLayoutStore,
} from "./uiLayoutStorage";
import type { UiLayoutStore } from "./uiLayoutTypes";

describe("uiLayoutStorage", () => {
  it("serializes and parses layout stores", () => {
    const layout = createDefaultLayout({
      viewport: { width: 1920, height: 1080 },
      now: 123456,
    });
    const store: UiLayoutStore = {
      schemaVersion: UI_LAYOUT_SCHEMA_VERSION,
      activeLayoutId: "default",
      layouts: [layout],
    };

    const raw = serializeLayoutStore(store);
    const parsed = parseLayoutStore(raw);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.store).toEqual(store);
    }
  });

  it("migrates older schema versions", () => {
    const legacy: UiLayoutStore = {
      schemaVersion: 0,
      activeLayoutId: "default",
      layouts: [
        createDefaultLayout({
          viewport: { width: 800, height: 600 },
          now: 1,
        }),
      ],
    };

    const migrated = migrateLayoutStore(legacy);
    expect(migrated?.schemaVersion).toBe(UI_LAYOUT_SCHEMA_VERSION);
  });

  it("rejects unsupported schema versions", () => {
    const future: UiLayoutStore = {
      schemaVersion: UI_LAYOUT_SCHEMA_VERSION + 1,
      activeLayoutId: "default",
      layouts: [
        createDefaultLayout({
          viewport: { width: 800, height: 600 },
          now: 1,
        }),
      ],
    };

    expect(migrateLayoutStore(future)).toBeNull();
  });
});
