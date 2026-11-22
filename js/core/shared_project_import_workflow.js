import { projectEditor } from "./hgo_project_routing.js";
import { captureImportDocumentIdentity, importProjectThroughFunnel } from "./interaction_funnel.js";
import { MAX_PROJECT_PACKAGE_ZIP_BYTES, prepareProjectImportFile } from "./project_package_io.js";
import { UNSAFE_RECORD_KEYS } from "./renderer/render_snapshot.js";
import { normalizeArtifactToken } from "./export_artifact_package.js";
import { sharedProjectError, validateSharedProjectUrl } from "./shared_project_url.js";
import { subscribeChanges } from "./state/changes.js";

const PAINT_FIELDS = [
  "visualOverrides", "featureOverrides", "colors", "sovereignBaseColors", "countryBaseColors",
];
const RECORD_FIELDS = [
  ...PAINT_FIELDS,
  "waterRegionOverrides", "specialZones", "parentBorderEnabledByCountry", "legendLabels",
  "countryNameOverrides", "cityNameOverrides", "capitalOverrides", "politicalOverrides",
  "politicalAlliances", "releasableBoundaryVariantByTag",
];

function inspectProject(payload, maxNodes) {
  const records = new Set(RECORD_FIELDS.map(key => payload[key]));
  records.add(payload.riverPaint?.overrides);
  let count = 0;
  function visit(value, depth) {
    if (++count > maxNodes || depth > 64) throw sharedProjectError("too-large");
    if (value === null || typeof value !== "object") return;
    const record = records.has(value);
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (key === "__proto__" || (record && UNSAFE_RECORD_KEYS.includes(key))) {
        throw sharedProjectError("unsafe-project-keys");
      }
      visit(value[key], depth + 1);
    }
  }
  visit(payload, 0);
  if (projectEditor(payload) !== "main") throw sharedProjectError("hgo-project");
  const hasPaint = PAINT_FIELDS.some(key => payload[key] && typeof payload[key] === "object" && !Array.isArray(payload[key]));
  const hasScenario = typeof payload.scenario?.id === "string" && payload.scenario.id.trim();
  if (!Number.isInteger(payload.schemaVersion) && !hasScenario && !hasPaint) {
    throw sharedProjectError("not-project");
  }
}

async function fetchProjectFile(url, { fetchImpl, timers, timeoutMs, maxBytes, maxZipBytes }) {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => controller.abort(sharedProjectError("timeout")), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url.href, {
        mode: "cors", credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer",
        cache: "no-store", signal: controller.signal,
      });
    } catch (error) {
      throw sharedProjectError(error instanceof TypeError ? "cors-blocked" : "fetch-failed");
    }
    if (response.type === "opaqueredirect" || [301, 302, 303, 307, 308].includes(response.status)) {
      throw sharedProjectError("redirect");
    }
    validateSharedProjectUrl(response.url);
    if (!response.ok) throw sharedProjectError("fetch-failed");
    const declaredBytes = Number(response.headers.get("content-length"));
    if (declaredBytes > maxBytes) throw sharedProjectError("too-large");
    if (!response.body) throw sharedProjectError("not-project");
    const reader = response.body.getReader();
    const chunks = [];
    const signature = [0x50, 0x4b, 0x03, 0x04];
    const prefix = new Uint8Array(signature.length);
    let zipped = false;
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size < prefix.length) {
        prefix.set(value.subarray(0, prefix.length - size), size);
        zipped = signature.every((byte, index) => prefix[index] === byte);
      }
      size += value.byteLength;
      if (size > maxBytes || (zipped && (size > maxZipBytes || declaredBytes > maxZipBytes))) {
        throw sharedProjectError("too-large");
      }
      chunks.push(value);
    }
    const stem = normalizeArtifactToken(url.pathname.split("/").pop().replace(/\.[^.]*$/, ""), "project").slice(0, 80);
    return new File(chunks, stem + (zipped ? ".zip" : ".json"), {
      type: zipped ? "application/zip" : "application/json",
    });
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    controller.abort();
    throw error;
  } finally {
    timers.clearTimeout(timer);
  }
}

export async function importSharedProject(url, {
  state, ui, hooks, updateState, importProject = importProjectThroughFunnel, fetchImpl = globalThis.fetch,
  timers = globalThis, timeoutMs = 30_000, maxBytes = 64 * 1024 * 1024,
  maxZipBytes = MAX_PROJECT_PACKAGE_ZIP_BYTES, maxNodes = 1_000_000,
}) {
  const isConfirmedDocument = captureImportDocumentIdentity(state);
  updateState({ status: "loading" });
  const file = await fetchProjectFile(validateSharedProjectUrl(url), {
    fetchImpl, timers, timeoutMs, maxBytes, maxZipBytes,
  });
  updateState({ status: "importing" });
  let projectPayload;
  try {
    if (file.type === "application/zip") {
      ({ projectPayload } = await prepareProjectImportFile(file, { materializeFile: false }));
    } else {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (!text.trimStart().startsWith("{")) throw sharedProjectError("not-project");
      projectPayload = JSON.parse(text);
    }
  } catch (error) {
    throw sharedProjectError(error.code === "PROJECT_ZIP_LIMIT" ? "too-large" : "not-project");
  }
  if (!projectPayload || typeof projectPayload !== "object" || Array.isArray(projectPayload)) {
    throw sharedProjectError("not-project");
  }
  inspectProject(projectPayload, maxNodes);
  if (!isConfirmedDocument()) {
    ui.showToast(ui.t("Project import cancelled.", "ui"), { tone: "warning" });
    return updateState({ status: "cancelled" });
  }
  const result = await importProject(null, {
    projectPayload, fileName: file.name, ui, hooks,
    importOptions: { successTitle: "Project imported", successMessage: "Project file loaded successfully." },
  });
  if (result?.status === "cancelled") return updateState({ status: "cancelled" });
  if (result !== true && !["committed", "committed-with-warnings"].includes(result?.status)) {
    throw sharedProjectError("import-failed");
  }
  const documentBinding = state.projectFileBinding;
  const unsubscribe = subscribeChanges(({ reason }) => {
    if (reason !== "history-clear" || state.projectFileBinding === documentBinding) return;
    unsubscribe();
    updateState({ status: "idle", host: "", errorCode: "", originalFile: null });
  });
  return updateState({ status: "success", originalFile: file });
}
