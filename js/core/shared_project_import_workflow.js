import { projectEditor } from "./hgo_project_routing.js";
import { importProjectThroughFunnel } from "./interaction_funnel.js";
import { MAX_PROJECT_PACKAGE_ZIP_BYTES, prepareProjectImportFile } from "./project_package_io.js";
import { UNSAFE_RECORD_KEYS } from "./renderer/render_snapshot.js";
import { normalizeArtifactToken } from "./export_artifact_package.js";
import { sharedProjectError, validateSharedProjectUrl } from "./shared_project_url.js";

const RECORD_FIELDS = [
  "visualOverrides", "featureOverrides", "colors", "sovereignBaseColors", "countryBaseColors",
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
}

async function fetchProjectFile(url, { fetchImpl, timers, timeoutMs, maxBytes, maxZipBytes }) {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => controller.abort(sharedProjectError("timeout")), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url.href, {
        mode: "cors", credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer",
        cache: "no-store", signal: controller.signal,
      });
    } catch (error) {
      throw sharedProjectError(error instanceof TypeError ? "cors-blocked" : "fetch-failed");
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
  ui, hooks, updateState, importProject = importProjectThroughFunnel, fetchImpl = globalThis.fetch,
  timers = globalThis, timeoutMs = 30_000, maxBytes = 64 * 1024 * 1024,
  maxZipBytes = MAX_PROJECT_PACKAGE_ZIP_BYTES, maxNodes = 1_000_000,
}) {
  const file = await fetchProjectFile(validateSharedProjectUrl(url), {
    fetchImpl, timers, timeoutMs, maxBytes, maxZipBytes,
  });
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
  updateState({ status: "importing" });
  const result = await importProject(null, {
    projectPayload, fileName: file.name, ui, hooks,
    importOptions: { successTitle: "Project imported", successMessage: "Project file loaded successfully." },
  });
  if (result?.status === "cancelled") return updateState({ status: "cancelled" });
  if (result !== true && !["committed", "committed-with-warnings"].includes(result?.status)) {
    throw sharedProjectError("import-failed");
  }
  return updateState({ status: "success", originalFile: file });
}
