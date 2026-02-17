import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SHARED_PROTOCOL_PACKAGE_NAME = "@mmo/shared-protocol";
const SHARED_SIM_PACKAGE_NAME = "@mmo/shared-sim";
const MANIFEST_FIELDS = ["dependencies", "devDependencies"];
const WORKSPACE_DIRECTORIES = ["apps", "packages"];

const workspaceRoot = process.cwd();

const hasManifest = async (directory) => {
  try {
    await access(path.join(directory, "package.json"));
    return true;
  } catch {
    return false;
  }
};

const findManifestPaths = async () => {
  const manifestPaths = [];

  for (const workspaceDirectory of WORKSPACE_DIRECTORIES) {
    const workspacePath = path.join(workspaceRoot, workspaceDirectory);
    let entries;

    try {
      entries = await readdir(workspacePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const projectPath = path.join(workspacePath, entry.name);
      if (await hasManifest(projectPath)) {
        manifestPaths.push(path.join(projectPath, "package.json"));
      }
    }
  }

  return manifestPaths;
};

const readJson = async (filePath) => {
  const json = await readFile(filePath, "utf8");
  return JSON.parse(json);
};

const getPackageFields = (manifest, packageName) => {
  const fields = [];

  for (const field of MANIFEST_FIELDS) {
    const deps = manifest[field];
    if (deps && typeof deps === "object" && Object.hasOwn(deps, packageName)) {
      fields.push(field);
    }
  }

  return fields;
};

const relativePath = (targetPath) => path.relative(workspaceRoot, targetPath);

const checkManifests = async () => {
  const violations = [];
  const manifestPaths = await findManifestPaths();

  for (const manifestPath of manifestPaths) {
    const manifest = await readJson(manifestPath);
    const protocolFields = getPackageFields(manifest, SHARED_PROTOCOL_PACKAGE_NAME);
    const simFields = getPackageFields(manifest, SHARED_SIM_PACKAGE_NAME);

    if (protocolFields.length === 0 || simFields.length === 0) {
      continue;
    }

    violations.push({
      manifestPath: relativePath(manifestPath),
      packageName: typeof manifest.name === "string" ? manifest.name : "(unknown package)",
      protocolFields,
      simFields,
    });
  }

  if (violations.length === 0) {
    console.log("Shared dependency guard passed.");
    return;
  }

  console.error(
    "Shared dependency guard failed. A project cannot declare both @mmo/shared-protocol and @mmo/shared-sim.",
  );

  for (const violation of violations) {
    console.error(`- ${violation.packageName} (${violation.manifestPath})`);
    console.error(`  @mmo/shared-protocol in: ${violation.protocolFields.join(", ")}`);
    console.error(`  @mmo/shared-sim in: ${violation.simFields.join(", ")}`);
  }

  process.exit(1);
};

await checkManifests();
