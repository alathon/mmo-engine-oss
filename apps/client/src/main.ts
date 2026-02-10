import "./shaders";
import "./ui/widgets/chat/chat.css";
import "./ui/widgets/hotbars/hotbar.css";
import "./ui/widgets/layoutControls/layoutControls.css";
import "./ui/widgets/performance/performance.css";
import { ClientApp } from "./game/clientApp";
import { uiLayoutManager } from "./ui/layout/UiLayoutManager";

const importDebug = () => import("@colyseus/sdk/debug");

// Initialize the game when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  uiLayoutManager.initializeStorage();
  const canvas = document.getElementById("game-canvas");

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
