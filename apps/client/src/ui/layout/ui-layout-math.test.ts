import { describe, expect, it } from "vitest";
import { clampWidgetOffsets } from "./ui-layout-math";
import type { UiWidgetLayout } from "./ui-layout-types";

describe("uiLayoutMath", () => {
  it("clamps top-left offsets inside the viewport", () => {
    const layout: UiWidgetLayout = {
      anchor: "top-left",
      offsetX: 120,
      offsetY: 120,
    };
    const viewport = { width: 100, height: 100 };
    const size = { width: 20, height: 20 };

    const clamped = clampWidgetOffsets(layout, viewport, size, 8);

    expect(clamped.offsetX).toBe(72);
    expect(clamped.offsetY).toBe(72);
  });

  it("clamps top-right offsets inside the viewport", () => {
    const layout: UiWidgetLayout = {
      anchor: "top-right",
      offsetX: -10,
      offsetY: 0,
    };
    const viewport = { width: 100, height: 100 };
    const size = { width: 20, height: 20 };

    const clamped = clampWidgetOffsets(layout, viewport, size, 8);

    expect(clamped.offsetX).toBe(8);
    expect(clamped.offsetY).toBe(8);
  });
});
