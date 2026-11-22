export const RENDER_SNAPSHOT_SCHEMA_VERSION = 1;
export const RENDER_SNAPSHOT_KIND = "render-snapshot";

export const RENDER_SNAPSHOT_ERROR = Object.freeze({
  INVALID: "RENDER_SNAPSHOT_INVALID",
  VERSION_UNSUPPORTED: "RENDER_SNAPSHOT_VERSION_UNSUPPORTED",
  KIND_UNSUPPORTED: "RENDER_SNAPSHOT_KIND_UNSUPPORTED",
});

export const UNSAFE_RECORD_KEYS = Object.freeze(["__proto__", "prototype", "constructor"]);

export class RenderSnapshotError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RenderSnapshotError";
    this.code = String(code || RENDER_SNAPSHOT_ERROR.INVALID);
    this.details = Object.freeze({ ...(details || {}) });
  }
}

function fail(code, message, details = {}) {
  throw new RenderSnapshotError(code, message, details);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, path) {
  if (!isPlainRecord(value)) {
    fail(RENDER_SNAPSHOT_ERROR.INVALID, `${path} must be a plain object.`, { path });
  }
  return value;
}

function requireText(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    fail(RENDER_SNAPSHOT_ERROR.INVALID, `${path} must be a non-empty string.`, { path });
  }
  return value.trim();
}

function requireFiniteNumber(value, path, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0)) {
    fail(
      RENDER_SNAPSHOT_ERROR.INVALID,
      `${path} must be ${positive ? "a positive finite number" : "finite"}.`,
      { path },
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function assertOnlyKeys(value, allowedKeys, path) {
  const keys = Object.keys(value);
  const unsafeKeys = keys.filter((key) => UNSAFE_RECORD_KEYS.includes(key));
  if (unsafeKeys.length) {
    fail(
      RENDER_SNAPSHOT_ERROR.INVALID,
      `${path} contains unsafe record keys.`,
      { path, unsafeKeys },
    );
  }
  const unknownKeys = keys.filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    fail(
      RENDER_SNAPSHOT_ERROR.INVALID,
      `${path} contains unsupported fields.`,
      { path, unknownKeys },
    );
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function cloneJsonValue(value, path = "$", ancestors = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return requireFiniteNumber(value, path);
  if (typeof value !== "object") {
    fail(RENDER_SNAPSHOT_ERROR.INVALID, `${path} must contain only JSON data.`, { path });
  }
  if (ancestors.has(value)) {
    fail(RENDER_SNAPSHOT_ERROR.INVALID, `${path} must not contain a cycle.`, { path });
  }
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    const expectedKeys = new Set(["length"]);
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      expectedKeys.add(key);
      if (!Object.hasOwn(value, key)) {
        fail(RENDER_SNAPSHOT_ERROR.INVALID, `${path} must not contain sparse array entries.`, {
          path,
          index,
        });
      }
    }
    const extraKeys = Reflect.ownKeys(value).filter((key) => !expectedKeys.has(key));
    if (extraKeys.length) {
      fail(RENDER_SNAPSHOT_ERROR.INVALID, `${path} contains unsupported array fields.`, {
        path,
        extraKeys: extraKeys.map(String),
      });
    }
    result = value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`, ancestors));
  } else {
    requireRecord(value, path);
    const keys = Object.keys(value).sort();
    const unsafeKeys = keys.filter((key) => UNSAFE_RECORD_KEYS.includes(key));
    if (unsafeKeys.length) {
      fail(
        RENDER_SNAPSHOT_ERROR.INVALID,
        `${path} contains unsafe record keys.`,
        { path, unsafeKeys },
      );
    }
    result = Object.assign(
      Object.create(null),
      Object.fromEntries(keys.map((key) => [
        key,
        cloneJsonValue(value[key], `${path}.${key}`, ancestors),
      ])),
    );
  }
  ancestors.delete(value);
  return deepFreeze(result);
}

function normalizeStringRecord(value, path) {
  const record = requireRecord(value, path);
  const normalized = Object.create(null);
  Object.keys(record).sort().forEach((key) => {
    if (UNSAFE_RECORD_KEYS.includes(key)) {
      fail(
        RENDER_SNAPSHOT_ERROR.INVALID,
        `${path} contains unsafe record keys.`,
        { path, unsafeKeys: [key] },
      );
    }
    const normalizedKey = requireText(key, `${path} key`);
    normalized[normalizedKey] = requireText(record[key], `${path}.${key}`);
  });
  return deepFreeze(normalized);
}

function normalizeViewport(value) {
  const viewport = requireRecord(value, "snapshot.viewport");
  assertOnlyKeys(
    viewport,
    ["transform", "renderSignature", "projectionSignature", "geoBounds"],
    "snapshot.viewport",
  );
  const transform = requireRecord(viewport.transform, "snapshot.viewport.transform");
  assertOnlyKeys(transform, ["x", "y", "k"], "snapshot.viewport.transform");
  if (!Array.isArray(viewport.geoBounds) || viewport.geoBounds.length !== 4) {
    fail(
      RENDER_SNAPSHOT_ERROR.INVALID,
      "snapshot.viewport.geoBounds must contain four finite numbers.",
      { path: "snapshot.viewport.geoBounds" },
    );
  }
  const geoBounds = viewport.geoBounds.map((entry, index) => (
    requireFiniteNumber(entry, `snapshot.viewport.geoBounds[${index}]`)
  ));
  if (geoBounds[0] > geoBounds[2] || geoBounds[1] > geoBounds[3]) {
    fail(
      RENDER_SNAPSHOT_ERROR.INVALID,
      "snapshot.viewport.geoBounds minima must not exceed maxima.",
      { path: "snapshot.viewport.geoBounds" },
    );
  }
  return deepFreeze({
    transform: {
      x: requireFiniteNumber(transform.x, "snapshot.viewport.transform.x"),
      y: requireFiniteNumber(transform.y, "snapshot.viewport.transform.y"),
      k: requireFiniteNumber(transform.k, "snapshot.viewport.transform.k", { positive: true }),
    },
    renderSignature: requireText(viewport.renderSignature, "snapshot.viewport.renderSignature"),
    projectionSignature: requireText(
      viewport.projectionSignature,
      "snapshot.viewport.projectionSignature",
    ),
    geoBounds,
  });
}

export function parseRenderSnapshot(value) {
  const raw = requireRecord(value, "snapshot");
  assertOnlyKeys(raw, ["schemaVersion", "kind", "palette", "ownership", "viewport"], "snapshot");
  if (raw.schemaVersion !== RENDER_SNAPSHOT_SCHEMA_VERSION) {
    fail(
      RENDER_SNAPSHOT_ERROR.VERSION_UNSUPPORTED,
      `snapshot.schemaVersion must be ${RENDER_SNAPSHOT_SCHEMA_VERSION}.`,
      { actual: raw.schemaVersion, expected: RENDER_SNAPSHOT_SCHEMA_VERSION },
    );
  }
  if (raw.kind !== RENDER_SNAPSHOT_KIND) {
    fail(
      RENDER_SNAPSHOT_ERROR.KIND_UNSUPPORTED,
      `snapshot.kind must be ${RENDER_SNAPSHOT_KIND}.`,
      { actual: raw.kind, expected: RENDER_SNAPSHOT_KIND },
    );
  }

  const palette = requireRecord(raw.palette, "snapshot.palette");
  assertOnlyKeys(palette, ["sovereignBaseColors"], "snapshot.palette");
  const ownership = requireRecord(raw.ownership, "snapshot.ownership");
  assertOnlyKeys(ownership, ["sovereigntyByFeatureId"], "snapshot.ownership");

  return deepFreeze({
    schemaVersion: RENDER_SNAPSHOT_SCHEMA_VERSION,
    kind: RENDER_SNAPSHOT_KIND,
    palette: {
      sovereignBaseColors: normalizeStringRecord(
        palette.sovereignBaseColors,
        "snapshot.palette.sovereignBaseColors",
      ),
    },
    ownership: {
      sovereigntyByFeatureId: normalizeStringRecord(
        ownership.sovereigntyByFeatureId,
        "snapshot.ownership.sovereigntyByFeatureId",
      ),
    },
    viewport: normalizeViewport(raw.viewport),
  });
}

export function createRenderSnapshot(value) {
  const raw = requireRecord(value, "snapshot");
  return parseRenderSnapshot({
    ...raw,
    schemaVersion: RENDER_SNAPSHOT_SCHEMA_VERSION,
    kind: RENDER_SNAPSHOT_KIND,
  });
}

export function getRenderSnapshotIdentity(value) {
  return JSON.stringify(parseRenderSnapshot(value));
}

export function createRenderSnapshotOwner() {
  function captureRenderSnapshot(renderState) {
    const transform = renderState?.viewportTransform;
    return createRenderSnapshot({
      palette: {
        sovereignBaseColors: renderState?.sovereignBaseColors,
      },
      ownership: {
        sovereigntyByFeatureId: renderState?.sovereigntyByFeatureId,
      },
      viewport: {
        transform: {
          x: Number(transform?.x ?? 0),
          y: Number(transform?.y ?? 0),
          k: Number(transform?.k ?? 1),
        },
        renderSignature: renderState?.viewportRenderSignature,
        projectionSignature: renderState?.projectionRenderSignature,
        geoBounds: renderState?.viewportGeoBounds,
      },
    });
  }

  return Object.freeze({ captureRenderSnapshot });
}

export const renderSnapshotInternals = Object.freeze({
  assertOnlyKeys,
  cloneJsonValue,
  deepFreeze,
  isPlainRecord,
});
