import type { LoginResponse } from "@mmo/shared";
import type { ClientState } from "./types";
import type { FullscreenUiController } from "../ui/fullscreenUiController";
import * as loginClient from "../network/loginClient";

/**
 * Login screen state.
 */
export class LoginState implements ClientState {
  private loginResponse?: LoginResponse;
  private isLoggingIn = false;
  private statusText?: HTMLParagraphElement;
  private loginButton?: HTMLButtonElement;
  private uiRoot?: HTMLElement;
  private uiContainer?: HTMLDivElement;
  private stylesheet?: HTMLLinkElement;
  private loginClickHandler?: () => void;
  private isActive = false;

  /**
   * Creates a login state instance.
   *
   * @param uiController - controller for full-screen UI.
   * @param onLoginSuccess - callback invoked with login response.
   */
  constructor(
    private uiController: FullscreenUiController,
    private onLoginSuccess: (response: LoginResponse) => void,
  ) {}

  /**
   * Enters the login state.
   */
  enter(): void {
    this.uiController.clear();
    this.mountUi();
    this.isActive = true;
  }

  /**
   * Exits the login state and clears UI.
   */
  exit(): void {
    this.unmountUi();
    this.isActive = false;
  }

  private mountUi(): void {
    const uiRoot = document.getElementById("ui");
    if (!uiRoot) {
      console.error("UI root not found");
      return;
    }

    this.uiRoot = uiRoot;
    this.ensureStylesheet();
    this.clearRoot();

    const container = document.createElement("div");
    container.className = "login-screen";

    const vignette = document.createElement("div");
    vignette.className = "login-vignette";

    const fog = document.createElement("div");
    fog.className = "login-fog";

    const shards = document.createElement("div");
    shards.className = "login-shards";
    for (let index = 0; index < 3; index += 1) {
      const shard = document.createElement("span");
      shard.className = `login-shard shard-${index + 1}`;
      shards.appendChild(shard);
    }

    const card = document.createElement("div");
    card.className = "login-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");

    const sigil = document.createElement("div");
    sigil.className = "login-sigil";
    sigil.setAttribute("aria-hidden", "true");

    const title = document.createElement("h1");
    title.className = "login-title";
    title.id = "login-title";
    title.textContent = "Welcome";

    const subtitle = document.createElement("p");
    subtitle.className = "login-subtitle";
    subtitle.textContent = "Enter the realm";

    const note = document.createElement("p");
    note.className = "login-note";
    note.textContent = "Your sigil is recognized by the gate.";

    const button = document.createElement("button");
    button.className = "login-button";
    button.type = "button";
    button.textContent = "Enter Realm";

    const status = document.createElement("p");
    status.className = "login-status";
    status.textContent = "";

    card.appendChild(sigil);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(note);
    card.appendChild(button);
    card.appendChild(status);

    container.appendChild(vignette);
    container.appendChild(fog);
    container.appendChild(shards);
    container.appendChild(card);

    this.loginClickHandler = () => {
      void this.handleLogin();
    };
    button.addEventListener("click", this.loginClickHandler);

    uiRoot.appendChild(container);

    this.uiContainer = container;
    this.loginButton = button;
    this.statusText = status;
  }

  private unmountUi(): void {
    if (this.loginButton && this.loginClickHandler) {
      this.loginButton.removeEventListener("click", this.loginClickHandler);
    }

    if (this.uiContainer?.parentElement) {
      this.uiContainer.parentElement.removeChild(this.uiContainer);
    }

    if (this.stylesheet?.parentElement) {
      this.stylesheet.parentElement.removeChild(this.stylesheet);
    }

    this.uiContainer = undefined;
    this.uiRoot = undefined;
    this.stylesheet = undefined;
    this.statusText = undefined;
    this.loginButton = undefined;
    this.loginClickHandler = undefined;
  }

  private ensureStylesheet(): void {
    const existing = document.querySelector<HTMLLinkElement>(
      "link[data-ui-style='login']",
    );
    if (existing) {
      this.stylesheet = existing;
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("../ui/login.css", import.meta.url).toString();
    link.dataset.uiStyle = "login";
    document.head.appendChild(link);
    this.stylesheet = link;
  }

  private clearRoot(): void {
    if (!this.uiRoot) {
      return;
    }
    while (this.uiRoot.firstChild) {
      this.uiRoot.removeChild(this.uiRoot.firstChild);
    }
  }

  private setStatus(
    message: string,
    tone: "neutral" | "success" | "error" = "neutral",
  ): void {
    if (!this.statusText) {
      return;
    }
    this.statusText.textContent = message;
    this.statusText.classList.remove("is-success", "is-error");
    if (tone === "success") {
      this.statusText.classList.add("is-success");
    }
    if (tone === "error") {
      this.statusText.classList.add("is-error");
    }
  }

  private async handleLogin(): Promise<void> {
    if (this.isLoggingIn) {
      return;
    }

    this.isLoggingIn = true;
    if (this.loginButton) {
      this.loginButton.disabled = true;
      this.loginButton.textContent = "Opening gate...";
    }
    this.setStatus("Contacting the gatekeeper...", "neutral");

    try {
      this.loginResponse = await loginClient.login();
      this.setStatus("Gate opens. Welcome.", "success");
      if (this.isActive) {
        this.onLoginSuccess(this.loginResponse);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown login error";
      this.setStatus(`Entry denied: ${message}`, "error");
      if (this.loginButton) {
        this.loginButton.disabled = false;
        this.loginButton.textContent = "Enter Realm";
      }
      this.isLoggingIn = false;
    }
  }
}
