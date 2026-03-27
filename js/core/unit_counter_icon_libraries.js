const HOI4_UNIT_COUNTER_MANIFEST_URL = "data/unit_counter_libraries/hoi4/manifest.json";
const HOI4_UNIT_COUNTER_REVIEW_DRAFT_STORAGE_KEY = "mapcreator_hoi4_unit_icon_review_v1";

/** @typedef {{ small: string|null, large: string|null, ship: string|null }} Hoi4UnitIconVariantSet */
/** @typedef {{ id: string, canonicalKey: string, kind: string, spriteName: string, spriteAliases?: string[], sourceGamePath: string, sourceTextureFile?: string, sourceScope: string, domain: string, label: string, keywords: string[], mappedPresetIds: string[], variants: Hoi4UnitIconVariantSet, searchText?: string }} Hoi4UnitIconEntry */
/** @typedef {{ version: number, libraryId: string, label: string, sourceScope: string, sourceRoot: string, entryCount: number, entries: Hoi4UnitIconEntry[], skipped?: object[], errors?: object[] }} Hoi4UnitIconManifest */
/** @typedef {{ version: number, libraryId: string, entryOverrides: Record<string, { mappedPresetIds?: string[] }>, presetCandidates: Record<string, string> }} Hoi4UnitIconReviewDraft */

let hoi4ManifestPromise = null;
/** @type {Hoi4UnitIconManifest|null} */
let hoi4ManifestCache = null;

function normalizeVariantPath(value = "") {
  const text = String(value || "").trim();
  return text || null;
}

function normalizePresetIds(values) {
  return Array.isArray(values)
    ? Array.from(new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)))
    : [];
}

/**
 * @returns {Hoi4UnitIconReviewDraft}
 */
function createEmptyHoi4UnitIconReviewDraft() {
  return {
    version: 1,
    libraryId: "hoi4",
    entryOverrides: {},
    presetCandidates: {},
  };
}

/**
 * @param {unknown} raw
 * @returns {Hoi4UnitIconReviewDraft}
 */
function normalizeHoi4UnitIconReviewDraft(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const draft = createEmptyHoi4UnitIconReviewDraft();
  draft.version = Number(source.version || 1) || 1;
  draft.libraryId = String(source.libraryId || "hoi4");
  draft.entryOverrides = source.entryOverrides && typeof source.entryOverrides === "object"
    ? Object.fromEntries(
        Object.entries(source.entryOverrides).map(([entryId, value]) => {
          const normalized = value && typeof value === "object" ? value : {};
          return [String(entryId || ""), {
            mappedPresetIds: normalizePresetIds(normalized.mappedPresetIds),
          }];
        }).filter(([entryId]) => Boolean(entryId))
      )
    : {};
  draft.presetCandidates = source.presetCandidates && typeof source.presetCandidates === "object"
    ? Object.fromEntries(
        Object.entries(source.presetCandidates)
          .map(([presetId, entryId]) => [String(presetId || "").trim().toLowerCase(), String(entryId || "").trim()])
          .filter(([presetId, entryId]) => Boolean(presetId && entryId))
      )
    : {};
  return draft;
}

/**
 * @param {unknown} raw
 * @returns {Hoi4UnitIconManifest}
 */
function normalizeHoi4UnitIconManifest(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawEntries = Array.isArray(source.entries) ? source.entries : [];
  const entries = rawEntries.map((entry) => {
    const normalized = entry && typeof entry === "object" ? entry : {};
    return {
      id: String(normalized.id || ""),
      canonicalKey: String(normalized.canonicalKey || ""),
      kind: String(normalized.kind || "division_small"),
      spriteName: String(normalized.spriteName || ""),
      spriteAliases: Array.isArray(normalized.spriteAliases)
        ? normalized.spriteAliases.map((value) => String(value || "")).filter(Boolean)
        : [],
      sourceGamePath: String(normalized.sourceGamePath || ""),
      sourceTextureFile: String(normalized.sourceTextureFile || ""),
      sourceScope: String(normalized.sourceScope || "vanilla"),
      domain: String(normalized.domain || "ground"),
      label: String(normalized.label || normalized.canonicalKey || normalized.spriteName || "HOI4 Icon"),
      keywords: Array.isArray(normalized.keywords)
        ? normalized.keywords.map((value) => String(value || "")).filter(Boolean)
        : [],
      mappedPresetIds: Array.isArray(normalized.mappedPresetIds)
        ? normalizePresetIds(normalized.mappedPresetIds)
        : [],
      variants: {
        small: normalizeVariantPath(normalized.variants?.small),
        large: normalizeVariantPath(normalized.variants?.large),
        ship: normalizeVariantPath(normalized.variants?.ship),
      },
      searchText: "",
    };
  }).filter((entry) => entry.id && (entry.variants.small || entry.variants.large || entry.variants.ship))
    .map((entry) => ({
      ...entry,
      searchText: [
        entry.label,
        entry.spriteName,
        entry.canonicalKey,
        entry.sourceTextureFile || "",
        ...(entry.spriteAliases || []),
        ...(entry.keywords || []),
        ...(entry.mappedPresetIds || []),
      ].join(" ").toLowerCase(),
    }));

  return {
    version: Number(source.version || 1) || 1,
    libraryId: String(source.libraryId || "hoi4"),
    label: String(source.label || "Hearts of Iron IV"),
    sourceScope: String(source.sourceScope || "vanilla"),
    sourceRoot: String(source.sourceRoot || ""),
    entryCount: entries.length,
    entries,
    skipped: Array.isArray(source.skipped) ? source.skipped : [],
    errors: Array.isArray(source.errors) ? source.errors : [],
  };
}

/**
 * @returns {Promise<Hoi4UnitIconManifest>}
 */
async function loadHoi4UnitIconManifest() {
  if (hoi4ManifestCache) return hoi4ManifestCache;
  if (!hoi4ManifestPromise) {
    hoi4ManifestPromise = fetch(HOI4_UNIT_COUNTER_MANIFEST_URL, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load HOI4 unit icon library (${response.status} ${response.statusText})`);
        }
        return response.json();
      })
      .then((payload) => {
        hoi4ManifestCache = normalizeHoi4UnitIconManifest(payload);
        return hoi4ManifestCache;
      })
      .catch((error) => {
        hoi4ManifestPromise = null;
        throw error;
      });
  }
  return hoi4ManifestPromise;
}

/**
 * @returns {Hoi4UnitIconReviewDraft}
 */
function loadHoi4UnitIconReviewDraft() {
  try {
    const raw = globalThis.localStorage?.getItem(HOI4_UNIT_COUNTER_REVIEW_DRAFT_STORAGE_KEY);
    if (!raw) return createEmptyHoi4UnitIconReviewDraft();
    return normalizeHoi4UnitIconReviewDraft(JSON.parse(raw));
  } catch (_error) {
    return createEmptyHoi4UnitIconReviewDraft();
  }
}

/**
 * @param {Hoi4UnitIconReviewDraft} draft
 * @returns {Hoi4UnitIconReviewDraft}
 */
function saveHoi4UnitIconReviewDraft(draft) {
  const normalized = normalizeHoi4UnitIconReviewDraft(draft);
  try {
    globalThis.localStorage?.setItem(
      HOI4_UNIT_COUNTER_REVIEW_DRAFT_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch (_error) {
    // Ignore storage failures and keep the draft in memory.
  }
  return normalized;
}

/**
 * @param {Hoi4UnitIconEntry} entry
 * @param {Hoi4UnitIconReviewDraft|null|undefined} draft
 * @returns {string[]}
 */
function getHoi4UnitIconMappedPresetIds(entry, draft) {
  const override = draft?.entryOverrides?.[String(entry?.id || "")];
  if (override && Object.prototype.hasOwnProperty.call(override, "mappedPresetIds")) {
    return normalizePresetIds(override.mappedPresetIds);
  }
  return normalizePresetIds(entry?.mappedPresetIds);
}

/**
 * @param {Hoi4UnitIconEntry} entry
 * @param {"small"|"large"} variant
 * @returns {string|null}
 */
function getHoi4UnitIconVariantPath(entry, variant = "small") {
  if (variant === "large") {
    return normalizeVariantPath(entry?.variants?.large);
  }
  return normalizeVariantPath(entry?.variants?.small) || normalizeVariantPath(entry?.variants?.ship);
}

/**
 * @param {Hoi4UnitIconEntry[]} entries
 * @param {{ query?: string, filter?: string, currentPresetId?: string, getMappedPresetIds?: ((entry: Hoi4UnitIconEntry) => string[])|null }} options
 */
function filterHoi4UnitIconEntries(entries, { query = "", filter = "all", currentPresetId = "", getMappedPresetIds = null } = {}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedFilter = String(filter || "all").trim().toLowerCase() || "all";
  const normalizedPresetId = String(currentPresetId || "").trim().toLowerCase();
  return entries.filter((entry) => {
    const mappedPresetIds = typeof getMappedPresetIds === "function"
      ? normalizePresetIds(getMappedPresetIds(entry))
      : normalizePresetIds(entry.mappedPresetIds);
    if (normalizedFilter === "current" && normalizedPresetId && !mappedPresetIds.includes(normalizedPresetId)) {
      return false;
    }
    if (["ground", "air", "naval"].includes(normalizedFilter) && entry.domain !== normalizedFilter) {
      return false;
    }
    if (!normalizedQuery) return true;
    const haystack = `${String(entry.searchText || "")} ${mappedPresetIds.join(" ")}`;
    return haystack.includes(normalizedQuery);
  });
}

export {
  createEmptyHoi4UnitIconReviewDraft,
  filterHoi4UnitIconEntries,
  getHoi4UnitIconMappedPresetIds,
  getHoi4UnitIconVariantPath,
  loadHoi4UnitIconReviewDraft,
  loadHoi4UnitIconManifest,
  normalizeHoi4UnitIconReviewDraft,
  saveHoi4UnitIconReviewDraft,
};
