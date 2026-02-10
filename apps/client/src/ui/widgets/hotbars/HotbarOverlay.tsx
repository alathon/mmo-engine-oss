import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { HotbarViewModel } from "./hotbarViewModel";
import { useWidgetLayout } from "../../layout/useWidgetLayout";
import { GameUIIcons } from "../../assets/gameUiIcons";

const useHotbarSnapshot = (viewModel: HotbarViewModel) => {
  const subscribe = useCallback(
    (listener: () => void) => viewModel.subscribe(listener),
    [viewModel],
  );
  const getSnapshot = useCallback(() => viewModel.getSnapshot(), [viewModel]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const HotbarOverlay = ({
  viewModel,
}: {
  viewModel: HotbarViewModel;
}) => {
  const snapshot = useHotbarSnapshot(viewModel);
  const { style, dragHandlers } = useWidgetLayout("hud.hotbar");
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      viewModel.activateSlot(index);
    },
    [viewModel],
  );

  useEffect(() => {
    GameUIIcons.preload();
  }, []);

  if (snapshot.slots.length === 0) {
    return null;
  }

  return (
    <div
      id="hotbar"
      aria-hidden="true"
      data-ui-interactive="true"
      style={style}
      {...dragHandlers}
    >
      {snapshot.slots.map((slot) => {
        const showCooldownOverlay = slot.cooldownActive;
        const showGcdOverlay = slot.gcdActive && !slot.cooldownActive;
        const slotClass = `hotbar-slot${
          slot.isPressed ? " pressed" : ""
        }${slot.isCasting ? " casting" : ""}`;
        const slotStyle = {
          "--gcd-ratio": `${slot.gcdRatio}`,
          "--cooldown-ratio": showCooldownOverlay
            ? "1"
            : `${slot.cooldownRatio}`,
        } as CSSProperties;
        const iconId = slot.iconId;
        let iconUrl: string | null = null;
        if (slot.index < 6 && iconId && GameUIIcons.hasIcon(iconId)) {
          iconUrl = GameUIIcons.getIconUrl(iconId);
        }

        return (
          <div
            key={slot.index}
            className={slotClass}
            style={slotStyle}
            data-ui-interactive="true"
            onPointerDown={(event) => handlePointerDown(event, slot.index)}
          >
            <div
              className="hotbar-slot__icon"
              style={{ opacity: slot.iconAlpha }}
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" draggable={false} />
              ) : (
                slot.abilityLabel
              )}
            </div>
            {showGcdOverlay ? <div className="hotbar-slot__gcd" /> : null}
            {showCooldownOverlay ? (
              <div className="hotbar-slot__cooldown" />
            ) : null}
            {slot.keyLabel ? (
              <div className="hotbar-slot__key">{slot.keyLabel}</div>
            ) : null}
            {slot.cooldownActive && slot.cooldownText ? (
              <div className="hotbar-slot__cooldown-text">
                {slot.cooldownText}
              </div>
            ) : null}
            {slot.abilityName ? (
              <div className="hotbar-tooltip">
                <div className="hotbar-tooltip__title">{slot.abilityName}</div>
                <div className="hotbar-tooltip__meta">
                  Cast: {slot.abilityCastText}
                </div>
                <div className="hotbar-tooltip__meta">
                  Cost: {slot.abilityResourceText}
                </div>
                {slot.abilityCooldownText ? (
                  <div className="hotbar-tooltip__meta">
                    Cooldown: {slot.abilityCooldownText}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
