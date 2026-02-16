import * as THREE from "three";
import {
  generateSoloNavMesh,
  type SoloNavMeshInput,
  type SoloNavMeshOptions,
} from "navcat/blocks";
import { createNavMeshHelper, getPositionsAndIndices } from "navcat/three";

type HeightMapDefinition = {
  url: string;
  subdivisions?: number;
  minHeight?: number;
  maxHeight?: number;
};

type ZoneDefinition = {
  id: string;
  name: string;
  sceneData: {
    width: number;
    height: number;
    ground: {
      heightMap: HeightMapDefinition;
    };
  };
};

type ObstacleDefinition = {
  shape: "box" | "sphere" | "cylinder";
  size: number;
  x: number;
  z: number;
  color: number;
};

type ObstacleFootprint =
  | {
      shape: "box";
      x: number;
      z: number;
      halfSizeX: number;
      halfSizeZ: number;
    }
  | {
      shape: "circle";
      x: number;
      z: number;
      radius: number;
    };

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = (event) => reject(event);
    image.src = url;
  });

const getImageData = (
  image: HTMLImageElement,
): { data: Uint8ClampedArray; width: number; height: number } => {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: imageData.data, width: canvas.width, height: canvas.height };
};

const filterIndicesByObstacleFootprints = (
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  footprints: ObstacleFootprint[],
): number[] => {
  if (footprints.length === 0) {
    return Array.from(indices);
  }

  const filtered: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const i0 = indices[index];
    const i1 = indices[index + 1];
    const i2 = indices[index + 2];

    const p0 = i0 * 3;
    const p1 = i1 * 3;
    const p2 = i2 * 3;

    const x0 = positions[p0];
    const z0 = positions[p0 + 2];
    const x1 = positions[p1];
    const z1 = positions[p1 + 2];
    const x2 = positions[p2];
    const z2 = positions[p2 + 2];

    const cx = (x0 + x1 + x2) / 3;
    const cz = (z0 + z1 + z2) / 3;

    let blocked = false;
    for (const footprint of footprints) {
      if (footprint.shape === "box") {
        if (
          (Math.abs(x0 - footprint.x) <= footprint.halfSizeX &&
            Math.abs(z0 - footprint.z) <= footprint.halfSizeZ) ||
          (Math.abs(x1 - footprint.x) <= footprint.halfSizeX &&
            Math.abs(z1 - footprint.z) <= footprint.halfSizeZ) ||
          (Math.abs(x2 - footprint.x) <= footprint.halfSizeX &&
            Math.abs(z2 - footprint.z) <= footprint.halfSizeZ) ||
          (Math.abs(cx - footprint.x) <= footprint.halfSizeX &&
            Math.abs(cz - footprint.z) <= footprint.halfSizeZ)
        ) {
          blocked = true;
          break;
        }
        continue;
      }

      const radiusSq = footprint.radius * footprint.radius;
      const dx0 = x0 - footprint.x;
      const dz0 = z0 - footprint.z;
      const dx1 = x1 - footprint.x;
      const dz1 = z1 - footprint.z;
      const dx2 = x2 - footprint.x;
      const dz2 = z2 - footprint.z;
      const dxc = cx - footprint.x;
      const dzc = cz - footprint.z;
      if (
        dx0 * dx0 + dz0 * dz0 <= radiusSq ||
        dx1 * dx1 + dz1 * dz1 <= radiusSq ||
        dx2 * dx2 + dz2 * dz2 <= radiusSq ||
        dxc * dxc + dzc * dzc <= radiusSq
      ) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      filtered.push(i0, i1, i2);
    }
  }

  return filtered;
};

void filterIndicesByObstacleFootprints;

const init = async (): Promise<void> => {
  const container = document.getElementById("app");
  if (!container) {
    throw new Error("Missing #app container");
  }

  const zoneUrl = new URL("../assets/testzone.zone.json", import.meta.url).href;
  const zoneResponse = await fetch(zoneUrl);
  if (!zoneResponse.ok) {
    throw new Error(`Failed to load zone definition (${zoneResponse.status})`);
  }
  const zone = (await zoneResponse.json()) as ZoneDefinition;

  const heightMap = zone.sceneData.ground.heightMap;
  const heightmapUrl = new URL(`../assets/${heightMap.url}`, import.meta.url)
    .href;
  const heightmapImage = await loadImage(heightmapUrl);
  const heightmapData = getImageData(heightmapImage);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101417);

  const axes = new THREE.AxesHelper(6);
  scene.add(axes);

  const createAxisLabel = (text: string, color: string): THREE.Sprite => {
    const canvas = document.createElement("canvas");
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context");
    }
    ctx.clearRect(0, 0, size, size);
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 2, 2);
    return sprite;
  };

  const axisX = createAxisLabel("X", "#ff4b4b");
  axisX.position.set(6.6, 0, 0);
  scene.add(axisX);

  const axisY = createAxisLabel("Y", "#4bff6a");
  axisY.position.set(0, 6.6, 0);
  scene.add(axisY);

  const axisZ = createAxisLabel("Z", "#4b6bff");
  axisZ.position.set(0, 0, 6.6);
  scene.add(axisZ);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  const cameraPosition = new THREE.Vector3(0, 45, 65);
  const cameraState = {
    yaw: Math.PI,
    pitch: -0.35,
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(40, 60, 20);
  scene.add(sun);

  const width = zone.sceneData.width;
  const height = zone.sceneData.height;
  const visualSubdivisionsX = Math.max(1, heightmapData.width - 1);
  const visualSubdivisionsY = Math.max(1, heightmapData.height - 1);
  const navmeshSubdivisionScale = 0.25;
  const navmeshSubdivisionsX = Math.max(
    1,
    Math.round(visualSubdivisionsX * navmeshSubdivisionScale),
  );
  const navmeshSubdivisionsY = Math.max(
    1,
    Math.round(visualSubdivisionsY * navmeshSubdivisionScale),
  );
  const minHeight = heightMap.minHeight ?? -2;
  const maxHeight = heightMap.maxHeight ?? 6;
  const heightRange = maxHeight - minHeight;

  const sampleHeightAtUv = (u: number, v: number): number => {
    const px = Math.min(
      heightmapData.width - 1,
      Math.max(0, Math.round(u * (heightmapData.width - 1))),
    );
    const py = Math.min(
      heightmapData.height - 1,
      Math.max(0, Math.round((1 - v) * (heightmapData.height - 1))),
    );
    const idx = (py * heightmapData.width + px) * 4;
    const r = heightmapData.data[idx];
    const g = heightmapData.data[idx + 1];
    const b = heightmapData.data[idx + 2];
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return minHeight + luminance * heightRange;
  };

  const sampleHeightAtWorld = (x: number, z: number): number => {
    const u = Math.min(1, Math.max(0, x / width + 0.5));
    const v = Math.min(1, Math.max(0, z / height + 0.5));
    return sampleHeightAtUv(u, v);
  };

  const applyHeightmapToGeometry = (meshGeometry: THREE.BufferGeometry) => {
    const positionAttribute = meshGeometry.getAttribute("position");
    const uvAttribute = meshGeometry.getAttribute("uv");

    for (let i = 0; i < positionAttribute.count; i += 1) {
      const u = uvAttribute.getX(i);
      const v = uvAttribute.getY(i);
      positionAttribute.setY(i, sampleHeightAtUv(u, v));
    }

    positionAttribute.needsUpdate = true;
    meshGeometry.computeVertexNormals();
  };

  const visualGeometry = new THREE.PlaneGeometry(
    width,
    height,
    visualSubdivisionsX,
    visualSubdivisionsY,
  );
  visualGeometry.rotateX(-Math.PI / 2);
  applyHeightmapToGeometry(visualGeometry);

  const navmeshGeometry = new THREE.PlaneGeometry(
    width,
    height,
    navmeshSubdivisionsX,
    navmeshSubdivisionsY,
  );
  navmeshGeometry.rotateX(-Math.PI / 2);
  applyHeightmapToGeometry(navmeshGeometry);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x5a7f56),
    roughness: 0.85,
    metalness: 0.05,
  });

  const ground = new THREE.Mesh(visualGeometry, material);
  ground.receiveShadow = true;
  scene.add(ground);

  const groundToggleButton = document.createElement("button");
  groundToggleButton.textContent = "Toggle Ground Mesh";
  groundToggleButton.style.position = "absolute";
  groundToggleButton.style.top = "16px";
  groundToggleButton.style.right = "16px";
  groundToggleButton.style.padding = "8px 12px";
  groundToggleButton.style.background = "#1f2a32";
  groundToggleButton.style.border = "1px solid #2f3f49";
  groundToggleButton.style.color = "#dce8f2";
  groundToggleButton.style.font = "600 12px system-ui, sans-serif";
  groundToggleButton.style.cursor = "pointer";
  groundToggleButton.style.borderRadius = "6px";
  container.appendChild(groundToggleButton);

  const keybindsPanel = document.createElement("div");
  keybindsPanel.style.position = "absolute";
  keybindsPanel.style.top = "56px";
  keybindsPanel.style.right = "16px";
  keybindsPanel.style.padding = "10px 12px";
  keybindsPanel.style.background = "#1f2a32";
  keybindsPanel.style.border = "1px solid #2f3f49";
  keybindsPanel.style.color = "#dce8f2";
  keybindsPanel.style.font = "600 12px system-ui, sans-serif";
  keybindsPanel.style.borderRadius = "6px";
  keybindsPanel.style.lineHeight = "1.35";
  keybindsPanel.innerHTML = [
    "<div>Arrow Keys: Move</div>",
    "<div>Mouse Drag: Rotate</div>",
    "<div>N: Toggle Navmesh</div>",
    "<div>V: Toggle Vertices</div>",
    "<div>T: Toggle Wireframe</div>",
  ].join("");
  container.appendChild(keybindsPanel);

  const obstacles: ObstacleDefinition[] = [
    { shape: "box", size: 6, x: -28, z: -20, color: 0xd97b3c },
    { shape: "box", size: 5, x: -10, z: -5, color: 0xb65852 },
    { shape: "box", size: 8, x: 20, z: -18, color: 0x8a6b5e },
    { shape: "box", size: 4.5, x: 30, z: 12, color: 0x8f6a9c },
    { shape: "box", size: 7, x: -25, z: 18, color: 0x5c7aa5 },
    { shape: "sphere", size: 5, x: 8, z: 22, color: 0x6fbf7a },
    { shape: "sphere", size: 4, x: -5, z: 28, color: 0x4ea8c9 },
    { shape: "sphere", size: 3.5, x: 2, z: -30, color: 0x9b6fc9 },
    { shape: "cylinder", size: 6, x: 12, z: -2, color: 0xf2c94c },
    { shape: "cylinder", size: 5, x: -18, z: 6, color: 0x66c2a5 },
    { shape: "cylinder", size: 4, x: 0, z: 10, color: 0xef6c6c },
    { shape: "cylinder", size: 7, x: 24, z: -2, color: 0x8fd14f },
  ];

  const obstacleMeshes: THREE.Mesh[] = [];

  for (const obstacle of obstacles) {
    let mesh: THREE.Mesh;
    if (obstacle.shape === "box") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(obstacle.size, obstacle.size, obstacle.size),
        new THREE.MeshStandardMaterial({ color: obstacle.color }),
      );
    } else if (obstacle.shape === "sphere") {
      const radius = obstacle.size / 2;
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 16),
        new THREE.MeshStandardMaterial({ color: obstacle.color }),
      );
    } else {
      const radius = obstacle.size / 2;
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, obstacle.size, 20),
        new THREE.MeshStandardMaterial({ color: obstacle.color }),
      );
    }

    const groundHeight = sampleHeightAtWorld(obstacle.x, obstacle.z);
    mesh.position.set(obstacle.x, groundHeight + obstacle.size / 2, obstacle.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    obstacleMeshes.push(mesh);
  }

  const navmeshGround = new THREE.Mesh(navmeshGeometry, material);

  const vertexGeometry = new THREE.BufferGeometry();
  const navmeshPositionAttribute = navmeshGeometry.getAttribute("position");
  vertexGeometry.setAttribute("position", navmeshPositionAttribute.clone());
  vertexGeometry.computeBoundingSphere();
  const vertexMaterial = new THREE.PointsMaterial({
    color: 0xff8a1d,
    size: 0.15,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
  });
  const vertexPoints = new THREE.Points(vertexGeometry, vertexMaterial);
  scene.add(vertexPoints);

  const navMeshOptions: SoloNavMeshOptions = {
    cellSize: 1,
    cellHeight: 0.25,
    walkableRadiusWorld: 0.3,
    walkableRadiusVoxels: Math.ceil(0.3 / 0.15),
    walkableClimbWorld: 2,
    walkableClimbVoxels: Math.ceil(2 / 0.25),
    walkableHeightWorld: 2,
    walkableHeightVoxels: Math.ceil(2 / 0.25),
    walkableSlopeAngleDegrees: 60,
    borderSize: 0,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxSimplificationError: 1.3,
    maxEdgeLength: 12,
    maxVerticesPerPoly: 5,
    detailSampleDistance: 0.15 * 6,
    detailSampleMaxError: 0.25 * 1,
  };

  const [positions, indices] = getPositionsAndIndices([
    navmeshGround,
    ...obstacleMeshes,
  ]);
  const navMeshInput: SoloNavMeshInput = {
    positions,
    indices,
  };
  const navMeshResult = generateSoloNavMesh(navMeshInput, navMeshOptions);
  const navMeshHelper = createNavMeshHelper(navMeshResult.navMesh);
  navMeshHelper.object.position.y += 0.05;
  scene.add(navMeshHelper.object);

  const grid = new THREE.GridHelper(width, 20, 0x2c3844, 0x1b242c);
  grid.position.y = minHeight - 0.02;
  scene.add(grid);

  const wireframeGeometry = new THREE.WireframeGeometry(navmeshGeometry);
  const wireframe = new THREE.LineSegments(
    wireframeGeometry,
    new THREE.LineBasicMaterial({
      color: 0x88c2ff,
      transparent: true,
      opacity: 0.5,
    }),
  );
  scene.add(wireframe);

  let showGround = true;
  let showNavmesh = true;
  let showVertices = true;
  let showWireframe = false;
  ground.visible = showGround;
  navMeshHelper.object.visible = showNavmesh;
  vertexPoints.visible = showVertices;
  wireframe.visible = showWireframe;

  groundToggleButton.addEventListener("click", () => {
    showGround = !showGround;
    ground.visible = showGround;
  });

  const keys = new Set<string>();
  const clock = new THREE.Clock();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const moveSpeed = 18;
  const rotateSpeed = 0.004;
  let dragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  const updateCamera = (): void => {
    const cosPitch = Math.cos(cameraState.pitch);
    const sinPitch = Math.sin(cameraState.pitch);
    const cosYaw = Math.cos(cameraState.yaw);
    const sinYaw = Math.sin(cameraState.yaw);

    forward.set(sinYaw * cosPitch, sinPitch, cosYaw * cosPitch).normalize();
    right.set(cosYaw, 0, -sinYaw).normalize();

    camera.position.copy(cameraPosition);
    camera.lookAt(cameraPosition.clone().add(forward));
  };

  updateCamera();

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);

  window.addEventListener("keydown", (event) => {
    if (
      event.code === "ArrowUp" ||
      event.code === "ArrowDown" ||
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight"
    ) {
      keys.add(event.code);
    }
    if (event.code === "KeyN") {
      showNavmesh = !showNavmesh;
      navMeshHelper.object.visible = showNavmesh;
    }
    if (event.code === "KeyV") {
      showVertices = !showVertices;
      vertexPoints.visible = showVertices;
    }
    if (event.code === "KeyT") {
      showWireframe = !showWireframe;
      wireframe.visible = showWireframe;
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener("pointerup", (event) => {
    dragging = false;
    renderer.domElement.releasePointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener("pointerleave", () => {
    dragging = false;
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    cameraState.yaw -= dx * rotateSpeed;
    cameraState.pitch -= dy * rotateSpeed;
    cameraState.pitch = Math.max(-1.2, Math.min(1.2, cameraState.pitch));
  });

  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();

    if (keys.size > 0) {
      if (keys.has("ArrowUp")) {
        cameraPosition.addScaledVector(forward, moveSpeed * delta);
      }
      if (keys.has("ArrowDown")) {
        cameraPosition.addScaledVector(forward, -moveSpeed * delta);
      }
      if (keys.has("ArrowLeft")) {
        cameraPosition.addScaledVector(right, moveSpeed * delta);
      }
      if (keys.has("ArrowRight")) {
        cameraPosition.addScaledVector(right, -moveSpeed * delta);
      }
    }

    updateCamera();
    renderer.render(scene, camera);
  });
};

void init();
