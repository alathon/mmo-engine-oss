import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Scene } from "@babylonjs/core/scene";
import type { ClientState } from "./types";
import type { FullscreenUiController } from "../ui/fullscreen-ui-controller";

/**
 * Minimal placeholder character select screen.
 */
export class CharacterSelectState implements ClientState {
  private isActive = false;
  private selectedIndex?: number;
  private entryButtons: HTMLButtonElement[] = [];
  private entryHandlers: (() => void)[] = [];
  private enterButton?: HTMLButtonElement;
  private enterClickHandler?: () => void;
  private uiRoot?: HTMLElement;
  private uiContainer?: HTMLDivElement;
  private stylesheet?: HTMLLinkElement;
  private previewRoot?: TransformNode;
  private previewMesh?: Mesh;
  private previewMaterial?: StandardMaterial;
  private previewLabel?: TextBlock;
  private previewTexture?: AdvancedDynamicTexture;
  private previewLight?: HemisphericLight;
  private cameraSnapshot?: {
    alpha: number;
    beta: number;
    radius: number;
    target: Vector3;
  };
  private characters = [
    {
      id: "char_riven",
      name: "Riven",
      detail: "Level 8 Wanderer",
      accent: "#f0c27a",
      color: new Color3(0.85, 0.62, 0.32),
    },
    {
      id: "char_nyra",
      name: "Nyra",
      detail: "Level 5 Mystic",
      accent: "#c79af3",
      color: new Color3(0.72, 0.55, 0.9),
    },
    {
      id: "char_kato",
      name: "Kato",
      detail: "Level 3 Vanguard",
      accent: "#7fbfe0",
      color: new Color3(0.45, 0.72, 0.86),
    },
  ];

  /**
   * Creates a character select state.
   *
   * @param uiController - controller for full-screen UI.
   * @param scene - Babylon.js scene used for the preview.
   * @param camera - active camera to reframe for preview.
   * @param onEnterWorld - callback invoked when user proceeds.
   */
  constructor(
    private uiController: FullscreenUiController,
    private scene: Scene,
    private camera: ArcRotateCamera,
    private onEnterWorld: (characterId: string, characterName: string) => void,
  ) {}

  /**
   * Enters the character select state.
   */
  enter(): void {
    this.uiController.clear();
    this.mountUi();
    this.createPreview();
    this.isActive = true;
    this.applySelection(0);
  }

  /**
   * Exits the character select state.
   */
  exit(): void {
    this.unmountUi();
    this.disposePreview();
    this.restoreCamera();
    this.isActive = false;
    this.selectedIndex = undefined;
    this.entryButtons = [];
    this.entryHandlers = [];
    this.enterButton = undefined;
    this.enterClickHandler = undefined;
  }

  private mountUi(): void {
    const uiRoot = document.querySelector<HTMLElement>("#ui");
    if (!uiRoot) {
      console.error("UI root not found");
      return;
    }

    this.uiRoot = uiRoot;
    this.ensureStylesheet();
    this.clearRoot();

    const container = document.createElement("div");
    container.className = "character-select-screen";

    const vignette = document.createElement("div");
    vignette.className = "character-select-vignette";

    const panel = document.createElement("div");
    panel.className = "character-select-panel";

    const crest = document.createElement("div");
    crest.className = "character-select-crest";
    crest.setAttribute("aria-hidden", "true");

    const title = document.createElement("h1");
    title.className = "character-select-title";
    title.textContent = "Choose Your Champion";

    const subtitle = document.createElement("p");
    subtitle.className = "character-select-subtitle";
    subtitle.textContent = "Each soul bears a story. Select the one who answers.";

    const list = document.createElement("div");
    list.className = "character-select-list";

    for (const [index, character] of this.characters.entries()) {
      const entry = document.createElement("button");
      entry.className = "character-select-entry";
      entry.type = "button";
      entry.style.setProperty("--accent", character.accent);

      const name = document.createElement("span");
      name.className = "character-select-name";
      name.textContent = character.name;

      const detail = document.createElement("span");
      detail.className = "character-select-detail";
      detail.textContent = character.detail;

      entry.append(name);
      entry.append(detail);

      const handler = () => {
        this.handleSelection(index);
      };
      entry.addEventListener("click", handler);

      this.entryButtons.push(entry);
      this.entryHandlers.push(handler);
      list.append(entry);
    }

    const hint = document.createElement("p");
    hint.className = "character-select-hint";
    hint.textContent = "Appearance preview appears to the right.";

    const actions = document.createElement("div");
    actions.className = "character-select-actions";

    const enterButton = document.createElement("button");
    enterButton.className = "character-select-enter";
    enterButton.type = "button";
    enterButton.disabled = true;
    enterButton.textContent = "Enter World";

    this.enterClickHandler = () => {
      if (this.isActive) {
        this.handleEnterWorld();
      }
    };
    enterButton.addEventListener("click", this.enterClickHandler);

    actions.append(enterButton);

    panel.append(crest);
    panel.append(title);
    panel.append(subtitle);
    panel.append(list);
    panel.append(hint);
    panel.append(actions);

    container.append(vignette);
    container.append(panel);

    uiRoot.append(container);

    this.uiContainer = container;
    this.enterButton = enterButton;
  }

  private unmountUi(): void {
    if (this.enterButton && this.enterClickHandler) {
      this.enterButton.removeEventListener("click", this.enterClickHandler);
    }

    for (const [index, button] of this.entryButtons.entries()) {
      const handler = this.entryHandlers[index];
      if (handler) {
        button.removeEventListener("click", handler);
      }
    }

    if (this.uiContainer?.parentElement) {
      this.uiContainer.remove();
    }

    if (this.stylesheet?.parentElement) {
      this.stylesheet.remove();
    }

    this.uiContainer = undefined;
    this.uiRoot = undefined;
    this.stylesheet = undefined;
  }

  private ensureStylesheet(): void {
    const existing = document.querySelector<HTMLLinkElement>(
      "link[data-ui-style='character-select']",
    );
    if (existing) {
      this.stylesheet = existing;
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("../ui/characterSelect.css", import.meta.url).toString();
    link.dataset.uiStyle = "character-select";
    document.head.append(link);
    this.stylesheet = link;
  }

  private clearRoot(): void {
    if (!this.uiRoot) {
      return;
    }
    while (this.uiRoot.firstChild) {
      this.uiRoot.firstChild.remove();
    }
  }

  private createPreview(): void {
    if (this.previewMesh || !this.scene) {
      return;
    }

    this.previewRoot = new TransformNode("character_select_preview_root", this.scene);
    this.previewMesh = MeshBuilder.CreateCapsule(
      "character_select_preview_mesh",
      {
        radius: 0.65,
        height: 2.2,
        tessellation: 24,
        subdivisions: 1,
      },
      this.scene,
    );
    this.previewMesh.parent = this.previewRoot;
    this.previewMesh.position = new Vector3(6.5, 1.1, 0);
    this.previewMesh.rotation = new Vector3(0, Math.PI * 0.25, 0);

    this.previewMaterial = new StandardMaterial("character_select_preview_material", this.scene);
    this.previewMaterial.diffuseColor = new Color3(0.6, 0.5, 0.4);
    this.previewMaterial.emissiveColor = new Color3(0.15, 0.1, 0.08);
    this.previewMaterial.specularColor = new Color3(0.2, 0.18, 0.16);
    this.previewMesh.material = this.previewMaterial;

    this.previewLight = new HemisphericLight(
      "character_select_preview_light",
      new Vector3(0.4, 1, 0.2),
      this.scene,
    );
    this.previewLight.intensity = 0.9;
    this.previewLight.diffuse = new Color3(1, 0.95, 0.85);
    this.previewLight.groundColor = new Color3(0.2, 0.17, 0.15);

    this.previewTexture = AdvancedDynamicTexture.CreateFullscreenUI(
      "character_select_preview_ui",
      true,
      this.scene,
    );

    const label = new TextBlock("character_select_preview_label", "");
    label.color = "#f4e9d8";
    label.fontSize = 24;
    label.fontFamily = '"Fraunces", "Georgia", serif';
    label.outlineColor = "#2c2117";
    label.outlineWidth = 4;
    label.shadowColor = "rgba(10, 8, 6, 0.7)";
    label.shadowBlur = 6;
    label.shadowOffsetX = 2;
    label.shadowOffsetY = 2;
    label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.previewTexture.addControl(label);
    this.previewLabel = label;

    label.linkWithMesh(this.previewMesh);
    label.linkOffsetY = -140;

    this.applyCameraPreview();
  }

  private disposePreview(): void {
    this.previewLabel?.dispose();
    this.previewTexture?.dispose();
    this.previewMesh?.dispose();
    this.previewMaterial?.dispose();
    this.previewLight?.dispose();
    this.previewRoot?.dispose();

    this.previewLabel = undefined;
    this.previewTexture = undefined;
    this.previewMesh = undefined;
    this.previewMaterial = undefined;
    this.previewLight = undefined;
    this.previewRoot = undefined;
  }

  private applyCameraPreview(): void {
    if (!this.previewMesh) {
      return;
    }

    if (!this.cameraSnapshot) {
      this.cameraSnapshot = {
        alpha: this.camera.alpha,
        beta: this.camera.beta,
        radius: this.camera.radius,
        target: this.camera.target.clone(),
      };
    }

    this.camera.setTarget(this.previewMesh.position);
    this.camera.alpha = -Math.PI / 2.8;
    this.camera.beta = Math.PI / 3.2;
    this.camera.radius = 9;
  }

  private restoreCamera(): void {
    if (!this.cameraSnapshot) {
      return;
    }

    this.camera.alpha = this.cameraSnapshot.alpha;
    this.camera.beta = this.cameraSnapshot.beta;
    this.camera.radius = this.cameraSnapshot.radius;
    this.camera.setTarget(this.cameraSnapshot.target);
    this.cameraSnapshot = undefined;
  }

  private handleSelection(index: number): void {
    if (!this.isActive) {
      return;
    }
    this.applySelection(index);
  }

  private applySelection(index: number): void {
    const character = this.characters[index];
    if (!character) {
      return;
    }

    this.selectedIndex = index;
    if (this.enterButton) {
      this.enterButton.disabled = false;
    }

    for (const [buttonIndex, button] of this.entryButtons.entries()) {
      button.classList.toggle("is-selected", buttonIndex === index);
    }

    if (this.previewMaterial) {
      this.previewMaterial.diffuseColor = character.color;
      this.previewMaterial.emissiveColor = character.color.scale(0.25);
      this.previewMaterial.specularColor = new Color3(0.25, 0.2, 0.18);
    }

    if (this.previewLabel) {
      this.previewLabel.text = character.name;
    }
  }

  private handleEnterWorld(): void {
    if (this.selectedIndex === undefined) {
      return;
    }

    const character = this.characters[this.selectedIndex];
    if (!character) {
      return;
    }

    this.onEnterWorld(character.id, character.name);
  }
}
