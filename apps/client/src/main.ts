import "./ui/widgets/chat/chat.css";
import "./ui/widgets/hotbars/hotbar.css";
import "./ui/widgets/layoutControls/layoutControls.css";
import "./ui/widgets/navmesh/navmesh-tuning.css";
import "./ui/widgets/performance/performance.css";

// On bad starts, Babylon can’t find some in-memory shader entries, falls back to loading `.fx` files,
// and gets HTML (`<...`) instead of GLSL from the vite server.
// A refresh often works because Vite/HMR has finished rebuilding chunks, so the shader side-effect imports
// register correctly on the second load.
// TODO: This seems like a bug in BabylonJS, but I'm not sure how to easily reproduce it :S this really wants
// a more elegant fix!
import "@babylonjs/core/Shaders/color.fragment";
import "@babylonjs/core/Shaders/color.vertex";
import "@babylonjs/core/Shaders/layer.fragment";
import "@babylonjs/core/Shaders/layer.vertex";
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/Shaders/rgbdDecode.fragment";

import { ClientApp } from "./game/client-app";
import { uiLayoutManager } from "./ui/layout/ui-layout-manager";

const importDebug = () => import("@colyseus/sdk/debug");

// Initialize the game when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  uiLayoutManager.initializeStorage();
  const canvas = document.querySelector("#game-canvas");

  if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
    console.error("Canvas element not found");
    return;
  }

  const app = new ClientApp();
  await app.initialize(canvas);

  if (process.env.NODE_ENV === "development") {
    importDebug();
  }
});
