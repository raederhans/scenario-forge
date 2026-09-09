import { strFromU8, strToU8, unzipSync, zipSync } from "../../vendor/fflate.browser.js";
import {
  normalizeArtifactPath,
  normalizeArtifactToken,
  normalizeManifestFileEntry,
  sha256Bytes,
} from "./export_artifact_package.js";

const PROJECT_PACKAGE_VERSION = 1;
const PROJECT_PACKAGE_MIME = "application/zip";
const PROJECT_PACKAGE_MANIFEST_PATH = "manifest.json";
const PROJECT_PACKAGE_PROJECT_PATH = "project/map_project.json";
const LEGACY_PROJECT_PATH = "map_project.json";
const LEGACY_PROJECT_MANIFEST_PATH = "map_project_manifest.json";
const MAX_PROJECT_PACKAGE_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_PROJECT_PACKAGE_ENTRY_COUNT = 128;
const MAX_PROJECT_PACKAGE_UNZIPPED_BYTES = 64 * 1024 * 1024;

const PROJECT_PACKAGE_CONTENT_PRESETS = Object.freeze({
  minimal: Object.freeze({
    includeProjectDirectory: true,
    includeExportSettings: false,
    includeResourceIndex: false,
    includeDiagnostics: false,
  }),
  recommended: Object.freeze({
    includeProjectDirectory: true,
    includeExportSettings: true,
    includeResourceIndex: true,
    includeDiagnostics: false,
  }),
  diagnostic: Object.freeze({
    includeProjectDirectory: true,
    includeExportSettings: true,
    includeResourceIndex: true,
    includeDiagnostics: true,
  }),
});

function resolveProjectPackageContentOptions(value = "recommended") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ...PROJECT_PACKAGE_CONTENT_PRESETS.recommended,
      ...value,
    };
  }
  const preset = String(value || "recommended").trim().toLowerCase();
  return {
    ...PROJECT_PACKAGE_CONTENT_PRESETS.recommended,
    ...(PROJECT_PACKAGE_CONTENT_PRESETS[preset] || {}),
  };
}

function serializeJsonBytes(value) {
  return strToU8(JSON.stringify(value, null, 2));
}

function buildProjectPackageSummary(payload = {}) {
  const layerVisibility = payload.layerVisibility && typeof payload.layerVisibility === "object"
    ? payload.layerVisibility
    : {};
  return {
    schemaVersion: Number(payload.schemaVersion || 0) || 0,
    timestamp: Number(payload.timestamp || 0) || 0,
    scenario: payload.scenario || null,
    exportTarget: String(payload.exportWorkbenchUi?.target || "composite"),
    visibleLayerCount: Object.values(layerVisibility).filter(Boolean).length,
    specialZoneLayerCount: Array.isArray(payload.specialZoneLayers?.layers)
      ? payload.specialZoneLayers.layers.length
      : 0,
  };
}

function buildProjectResourceIndex(payload = {}, options = {}) {
  const editableProjectPath = options.includeProjectDirectory
    ? PROJECT_PACKAGE_PROJECT_PATH
    : LEGACY_PROJECT_PATH;
  const resources = {
    editableProject: editableProjectPath,
    legacyEditableProject: LEGACY_PROJECT_PATH,
  };
  if (options.includeExportSettings) {
    resources.exportSettings = "metadata/export_settings.json";
  }
  if (options.includeDiagnostics) {
    resources.diagnostics = "diagnostics/package_report.json";
  }
  return {
    packageRole: "editable-project-resource-index",
    scenario: payload.scenario || null,
    project: {
      schemaVersion: Number(payload.schemaVersion || 0) || 0,
      timestamp: Number(payload.timestamp || 0) || 0,
    },
    resources,
  };
}

function buildProjectPackageReport(payload = {}, options = {}) {
  return {
    packageRole: "editable-project-diagnostics",
    generatedAt: new Date().toISOString(),
    summary: buildProjectPackageSummary(payload),
    includedOptions: {
      includeProjectDirectory: !!options.includeProjectDirectory,
      includeExportSettings: !!options.includeExportSettings,
      includeResourceIndex: !!options.includeResourceIndex,
      includeDiagnostics: !!options.includeDiagnostics,
    },
    notes: [
      "Project JSON is the editable source of truth.",
      "Export artifact files remain owned by the export workbench.",
    ],
  };
}

async function normalizeProjectPackageFiles(files = []) {
  const seenPaths = new Set();
  const normalized = [];
  for (const file of files) {
    const path = normalizeArtifactPath(file?.path, `file-${normalized.length + 1}.bin`);
    if (seenPaths.has(path)) {
      throw new Error(`Duplicate project package file path: ${path}`);
    }
    seenPaths.add(path);
    const bytes = file?.bytes instanceof Uint8Array ? file.bytes : serializeJsonBytes(file?.json ?? {});
    normalized.push({
      path,
      bytes,
      meta: {
        path,
        role: normalizeArtifactToken(file?.role, "payload"),
        mime: String(file?.mime || "application/octet-stream").trim(),
        byteLength: bytes.byteLength,
        checksum: await sha256Bytes(bytes),
      },
    });
  }
  return normalized;
}

function buildProjectPackageManifest({
  payload = {},
  files = [],
  contentPreset = "recommended",
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    artifactVersion: PROJECT_PACKAGE_VERSION,
    artifactKind: "project-zip",
    packageKind: "editable-project-package",
    contentPreset: normalizeArtifactToken(contentPreset, "recommended"),
    generatedAt,
    scenario: payload.scenario || null,
    project: {
      schemaVersion: Number(payload.schemaVersion || 0) || 0,
      timestamp: Number(payload.timestamp || 0) || 0,
    },
    exportUi: payload.exportWorkbenchUi || null,
    summary: buildProjectPackageSummary(payload),
    files: files.map((file, index) => normalizeManifestFileEntry(file, `file-${index + 1}.bin`)),
  };
}

async function buildProjectPackagePayload(payload, { contentPreset = "recommended" } = {}) {
  const options = resolveProjectPackageContentOptions(contentPreset);
  const projectBytes = serializeJsonBytes(payload);
  const files = [{
    path: LEGACY_PROJECT_PATH,
    role: "editable-project",
    mime: "application/json",
    bytes: projectBytes,
  }];

  if (options.includeProjectDirectory) {
    files.push({
      path: PROJECT_PACKAGE_PROJECT_PATH,
      role: "editable-project",
      mime: "application/json",
      bytes: projectBytes,
    });
  }
  if (options.includeExportSettings) {
    files.push({
      path: "metadata/export_settings.json",
      role: "export-settings",
      mime: "application/json",
      json: payload.exportWorkbenchUi || {},
    });
  }
  if (options.includeResourceIndex) {
    files.push({
      path: "resources/project_resource_index.json",
      role: "resource-index",
      mime: "application/json",
      json: buildProjectResourceIndex(payload, options),
    });
  }
  if (options.includeDiagnostics) {
    files.push({
      path: "diagnostics/package_report.json",
      role: "package-diagnostics",
      mime: "application/json",
      json: buildProjectPackageReport(payload, options),
    });
  }

  const normalizedFiles = await normalizeProjectPackageFiles(files);
  const manifest = buildProjectPackageManifest({
    payload,
    files: normalizedFiles,
    contentPreset,
  });
  const legacyManifest = {
    artifactKind: "project-zip",
    packageKind: "editable-project-package",
    manifestPath: PROJECT_PACKAGE_MANIFEST_PATH,
    projectPath: PROJECT_PACKAGE_PROJECT_PATH,
    legacyProjectPath: LEGACY_PROJECT_PATH,
  };
  const zipEntries = Object.fromEntries(normalizedFiles.map((file) => [file.path, file.bytes]));
  zipEntries[PROJECT_PACKAGE_MANIFEST_PATH] = serializeJsonBytes(manifest);
  zipEntries[LEGACY_PROJECT_MANIFEST_PATH] = serializeJsonBytes(legacyManifest);

  return {
    blob: new Blob([zipSync(zipEntries)], { type: PROJECT_PACKAGE_MIME }),
    filename: "map_project.zip",
    manifest,
    pickerTypes: [{
      description: "Project ZIP package",
      accept: {
        [PROJECT_PACKAGE_MIME]: [".zip"],
      },
    }],
  };
}

function fileLooksLikeProjectZip(file) {
  const name = String(file?.name || "").trim().toLowerCase();
  const type = String(file?.type || "").trim().toLowerCase();
  return name.endsWith(".zip") || type === PROJECT_PACKAGE_MIME || type === "application/x-zip-compressed";
}

function buildJsonProjectFile(text, filename = "map_project.json") {
  const blob = new Blob([text], { type: "application/json" });
  if (typeof File === "function") {
    return new File([blob], filename, { type: "application/json" });
  }
  Object.defineProperty(blob, "name", {
    value: filename,
    configurable: true,
  });
  return blob;
}

function assertProjectZipFileBudget(file) {
  const size = Number(file?.size || 0) || 0;
  if (size > MAX_PROJECT_PACKAGE_ZIP_BYTES) {
    throw new Error("Project ZIP is too large for editable project import.");
  }
}

function assertProjectZipEntryBudget(entries = {}) {
  const entryNames = Object.keys(entries);
  if (entryNames.length > MAX_PROJECT_PACKAGE_ENTRY_COUNT) {
    throw new Error("Project ZIP contains too many files for editable project import.");
  }
  const totalBytes = entryNames.reduce((sum, name) => {
    const entry = entries[name];
    return sum + (entry instanceof Uint8Array ? entry.byteLength : 0);
  }, 0);
  if (totalBytes > MAX_PROJECT_PACKAGE_UNZIPPED_BYTES) {
    throw new Error("Project ZIP expands beyond the editable project import limit.");
  }
}

function parseJsonBytes(bytes, fallback = null) {
  if (!bytes) return fallback;
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return fallback;
  }
}

function parseProjectPackageManifest(entries = {}) {
  if (entries[PROJECT_PACKAGE_MANIFEST_PATH]) {
    try {
      return JSON.parse(strFromU8(entries[PROJECT_PACKAGE_MANIFEST_PATH]));
    } catch {
      throw new Error("Project package manifest cannot be parsed.");
    }
  }
  const legacyManifest = parseJsonBytes(entries[LEGACY_PROJECT_MANIFEST_PATH], null);
  if (legacyManifest?.manifestPath === PROJECT_PACKAGE_MANIFEST_PATH) {
    throw new Error("Project ZIP is missing manifest.json.");
  }
  return legacyManifest || {};
}

function buildProjectPackagePreview({ file, entries, manifest, projectPayload }) {
  const entryNames = Object.keys(entries || {}).sort();
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const summary = buildProjectPackageSummary(projectPayload);
  return {
    filename: String(file?.name || "map_project.zip"),
    packageKind: String(manifest?.packageKind || "editable-project-package"),
    artifactKind: String(manifest?.artifactKind || "project-zip"),
    contentPreset: String(manifest?.contentPreset || ""),
    generatedAt: String(manifest?.generatedAt || ""),
    scenario: projectPayload?.scenario || null,
    project: {
      schemaVersion: Number(projectPayload?.schemaVersion || 0) || 0,
      timestamp: Number(projectPayload?.timestamp || 0) || 0,
    },
    summary,
    entryCount: entryNames.length,
    entries: entryNames,
    files,
  };
}

function normalizeScenarioIdentity(value) {
  if (!value || typeof value !== "object") return { id: "", version: 0, baselineHash: "" };
  return {
    id: String(value.id || "").trim(),
    version: Number(value.version || 0) || 0,
    baselineHash: String(value.baselineHash || "").trim(),
  };
}

function projectManifestMatchesPayload(manifest = {}, projectPayload = {}) {
  if (!manifest || typeof manifest !== "object") return true;
  if (manifest.project && typeof manifest.project === "object") {
    const manifestSchema = Number(manifest.project.schemaVersion || 0) || 0;
    const payloadSchema = Number(projectPayload.schemaVersion || 0) || 0;
    if (manifestSchema && payloadSchema && manifestSchema !== payloadSchema) return false;
    const manifestTimestamp = Number(manifest.project.timestamp || 0) || 0;
    const payloadTimestamp = Number(projectPayload.timestamp || 0) || 0;
    if (manifestTimestamp && payloadTimestamp && manifestTimestamp !== payloadTimestamp) return false;
  }
  if (manifest.scenario && typeof manifest.scenario === "object") {
    const manifestScenario = normalizeScenarioIdentity(manifest.scenario);
    const payloadScenario = normalizeScenarioIdentity(projectPayload.scenario);
    if (manifestScenario.id && payloadScenario.id && manifestScenario.id !== payloadScenario.id) return false;
    if (manifestScenario.version && payloadScenario.version && manifestScenario.version !== payloadScenario.version) return false;
    if (
      manifestScenario.baselineHash
      && payloadScenario.baselineHash
      && manifestScenario.baselineHash !== payloadScenario.baselineHash
    ) {
      return false;
    }
  }
  return true;
}

function isStrictProjectPackageManifest(manifest = {}) {
  return manifest?.packageKind === "editable-project-package"
    || Number(manifest?.artifactVersion || 0) === PROJECT_PACKAGE_VERSION;
}

async function validateManifestProjectEntry({ manifest, projectBytes, selectedProjectPath }) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const strictManifest = isStrictProjectPackageManifest(manifest);
  if (!files.length) {
    if (strictManifest) {
      throw new Error("Project package manifest does not list the editable project file.");
    }
    return;
  }
  const selectedEntries = files.filter((file) => (
    file?.path === selectedProjectPath
    && String(file?.role || "editable-project") === "editable-project"
  ));
  const projectEntries = strictManifest
    ? selectedEntries
    : files.filter((file) => (
      file?.path === selectedProjectPath
      || file?.path === PROJECT_PACKAGE_PROJECT_PATH
      || file?.path === LEGACY_PROJECT_PATH
    ));
  if (!projectEntries.length) {
    throw new Error("Project package manifest does not list the editable project file.");
  }
  const checksumEntries = projectEntries.filter((file) => String(file?.checksum || "").trim());
  if (strictManifest && !checksumEntries.length) {
    throw new Error("Project package manifest must include editable project checksum.");
  }
  if (!checksumEntries.length) return;
  const checksum = await sha256Bytes(projectBytes);
  if (!checksumEntries.some((file) => file.checksum === checksum)) {
    throw new Error("Project package manifest does not match editable project.");
  }
}

async function prepareProjectImportFile(file, { materializeFile = true } = {}) {
  if (!fileLooksLikeProjectZip(file)) {
    return { file, preview: null, manifest: null };
  }
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Project ZIP cannot be read by this browser.");
  }
  assertProjectZipFileBudget(file);
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  assertProjectZipEntryBudget(entries);
  const selectedProjectPath = entries[PROJECT_PACKAGE_PROJECT_PATH]
    ? PROJECT_PACKAGE_PROJECT_PATH
    : LEGACY_PROJECT_PATH;
  const projectBytes = entries[selectedProjectPath];
  if (!projectBytes) {
    throw new Error("Project ZIP must include project/map_project.json or map_project.json.");
  }
  const manifest = parseProjectPackageManifest(entries);
  const projectText = strFromU8(projectBytes);
  const projectPayload = JSON.parse(projectText);
  await validateManifestProjectEntry({ manifest, projectBytes, selectedProjectPath });
  if (!projectManifestMatchesPayload(manifest, projectPayload)) {
    throw new Error("Project package manifest does not match editable project.");
  }
  const preview = buildProjectPackagePreview({
    file,
    entries,
    manifest,
    projectPayload,
  });
  return {
    file: materializeFile ? buildJsonProjectFile(projectText, "map_project.json") : null,
    projectPayload,
    preview,
    manifest,
  };
}

export {
  LEGACY_PROJECT_PATH,
  PROJECT_PACKAGE_CONTENT_PRESETS,
  PROJECT_PACKAGE_MANIFEST_PATH,
  PROJECT_PACKAGE_MIME,
  PROJECT_PACKAGE_PROJECT_PATH,
  buildProjectPackagePayload,
  fileLooksLikeProjectZip,
  prepareProjectImportFile,
  resolveProjectPackageContentOptions,
};
