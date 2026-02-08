import "./shaders";
import "./ui/chat/chat.css";
import "./ui/hotbars/hotbar.css";
import { ClientApp } from "./game/clientApp";

const importDebug = () => import("@colyseus/sdk/debug");

// Initialize the game when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
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
