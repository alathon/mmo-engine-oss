import {
  useCallback,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { HotbarViewModel } from "./hotbarViewModel";

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
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      viewModel.activateSlot(index);
    },
    [viewModel],
  );

  if (snapshot.slots.length === 0) {
    return null;
  }

  return (
    <div id="hotbar" aria-hidden="true">
      {snapshot.slots.map((slot) => {
        const slotClass = `hotbar-slot${slot.isPressed ? " pressed" : ""}`;
        const slotStyle = {
          "--gcd-ratio": `${slot.gcdRatio}`,
          "--cooldown-ratio": `${slot.cooldownRatio}`,
        } as CSSProperties;

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
              {slot.abilityLabel}
            </div>
            {slot.gcdActive ? <div className="hotbar-slot__gcd" /> : null}
            {slot.cooldownActive ? (
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
