import fireballUrl from "@mmo/assets/icons/llm-slop/fireball.png?url";
import iceStormUrl from "@mmo/assets/icons/llm-slop/ice-storm.png?url";
import quickDartUrl from "@mmo/assets/icons/llm-slop/quick-dart.png?url";
import shieldBashUrl from "@mmo/assets/icons/llm-slop/shield-bash.png?url";
import overgrowthUrl from "@mmo/assets/icons/llm-slop/overgrowth.png?url";
import skySwordUrl from "@mmo/assets/icons/llm-slop/sky-sword.png?url";

const ICON_URLS = {
  "quick-dart": quickDartUrl,
  "shield-bash": shieldBashUrl,
  fireball: fireballUrl,
  "sky-sword": skySwordUrl,
  "ice-storm": iceStormUrl,
  overgrowth: overgrowthUrl,
} as const;

export type GameUIIconId = keyof typeof ICON_URLS;

const GAME_UI_ICON_IDS = Object.keys(ICON_URLS) as GameUIIconId[];

export const GameUIIcons = {
  getIconUrl: (id: GameUIIconId): string => ICON_URLS[id],
  hasIcon: (id: string): id is GameUIIconId =>
    Object.prototype.hasOwnProperty.call(ICON_URLS, id),
  preload: (ids: readonly GameUIIconId[] = GAME_UI_ICON_IDS): void => {
    if (typeof Image === "undefined") {
      return;
    }
    for (const id of ids) {
      const img = new Image();
      img.src = ICON_URLS[id];
    }
  },
};
