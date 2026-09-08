// Scenario bundle runtime controller.
// 这个模块负责 loadScenarioBundle 主交易、startup bootstrap cache probe/write、bundle assemble 与 cache-hit 恢复。
// scenario_resources.js 继续保留 facade、startup hydration、optional layer 与对外 export 面。

import { trimScenarioBundleCache } from "./bundle_cache.js";
import { setStartupScenarioBootstrapCacheStatus } from "../state/actions/boot_actions.js";

function createScenarioBundleRuntimeController({
  state,
  STARTUP_CACHE_KINDS,
  normalizeScenarioId,
  normalizeScenarioBundleLevel,
  normalizeScenarioLanguage,
  scenarioBundleSatisfiesLevel,
  scenarioBundleUsesChunkedLayer,
  scenarioSupportsChunkedRuntime,
  scenarioBundleHasChunkedData,
  prewarmScenarioOptionalLayersOnCacheHit,
  recordScenarioPerfMetric,
  loadScenarioRegistry,
  getScenarioMetaById,
  loadScenarioJsonResourceWithTimeout,
  getScenarioGeoLocalePatchDescriptor,
  normalizeScenarioRuntimeShell,
  isStartupCacheEnabled,
  createStartupScenarioBootstrapCoreCacheKey,
  createStartupScenarioBootstrapLocaleCacheKey,
  readStartupCacheEntry,
  writeStartupCacheEntry,
  hasScenarioRuntimeShellContract,
  createScenarioBootstrapBundleFromCache,
  createSerializableStartupScenarioBootstrapCorePayload,
  createSerializableStartupScenarioBootstrapLocalePayload,
  loadOptionalScenarioResource,
  normalizeScenarioGeoLocalePatchPayload,
  ensureScenarioChunkRegistryLoaded,
  assembleScenarioBundle,
  scheduleScenarioDeferredBundleMetadataLoad,
} = {}) {
  const bundleLoadPromisesByKey = new Map();
  const bundleCacheRecency = new Map();
  const normalizeBundleLoadKeyPart = (value, fallback = "") => String(value ?? fallback).trim() || fallback;
  const normalizeSourceShaMetadata = (source = null) => {
    const payload = source && typeof source === "object" ? source : {};
    return {
      runtime_topology_sha256: normalizeBundleLoadKeyPart(payload.runtime_topology_sha256),
      runtime_bootstrap_topology_sha256: normalizeBundleLoadKeyPart(payload.runtime_bootstrap_topology_sha256),
      detail_chunk_manifest_sha256: normalizeBundleLoadKeyPart(payload.detail_chunk_manifest_sha256),
    };
  };
  const sourceShaMetadataMatches = (left = null, right = null) => {
    const normalizedLeft = normalizeSourceShaMetadata(left);
    const normalizedRight = normalizeSourceShaMetadata(right);
    return Object.keys(normalizedLeft).every((key) => normalizedLeft[key] === normalizedRight[key]);
  };

  function retainBundleInCache(targetId, bundle) {
    if (!bundle || !targetId) return;
    trimScenarioBundleCache(state, bundleCacheRecency, targetId);
  }

  function buildBundleLoadKey({
    targetId,
    requestedBundleLevel,
    currentLanguage,
    runtimeShellVersion,
  }) {
    const normalizedLanguage = normalizeScenarioLanguage(currentLanguage);
    return [
      `scenario=${normalizeBundleLoadKeyPart(targetId)}`,
      `level=${normalizeBundleLoadKeyPart(requestedBundleLevel, "full")}`,
      `language=${normalizeBundleLoadKeyPart(normalizedLanguage, "en")}`,
      `runtime_shell=${normalizeBundleLoadKeyPart(runtimeShellVersion, "1")}`,
    ].join("|");
  }

  async function tryLoadBootstrapBundleFromPersistentCache({
    d3Client,
    targetId,
    requestedBundleLevel,
    priorBundle,
    meta,
    manifest,
    runtimeShell,
    runtimeTopologyUrl,
    geoLocalePatchDescriptor,
    scenarioBootstrapCoreCacheKey,
    scenarioBootstrapLocaleCacheKey,
    loadStartedAt,
  }) {
    if (!scenarioBootstrapCoreCacheKey) {
      return null;
    }
    try {
      const [coreEntry, localeEntry] = await Promise.all([
        readStartupCacheEntry(scenarioBootstrapCoreCacheKey),
        scenarioBootstrapLocaleCacheKey
          ? readStartupCacheEntry(scenarioBootstrapLocaleCacheKey).catch((error) => {
            console.warn(`[scenario] Startup bootstrap locale cache read failed for "${targetId}".`, error);
            return null;
          })
          : Promise.resolve(null),
      ]);
      if (
        coreEntry?.payload?.countriesPayload
        && coreEntry?.payload?.ownersPayload
        && coreEntry?.payload?.coresPayload
        && hasScenarioRuntimeShellContract({
          runtimeTopologyPayload: coreEntry?.payload?.runtimeTopologyPayload,
          runtimePoliticalMeta: coreEntry?.payload?.runtimePoliticalMeta || null,
        })
      ) {
        if (!sourceShaMetadataMatches(manifest?.source, coreEntry?.payload?.source)) {
          setStartupScenarioBootstrapCacheStatus(state, "miss-source-sha");
          return null;
        }
        setStartupScenarioBootstrapCacheStatus(state, "hit");
        const bundle = createScenarioBootstrapBundleFromCache({
          priorBundle,
          meta,
          manifest,
          bundleLevel: requestedBundleLevel,
          cachedCorePayload: coreEntry.payload,
          cachedLocalePayload: localeEntry?.payload || null,
          geoLocalePatchDescriptor,
          runtimeTopologyUrl,
        });
        if (!bundle.geoLocalePatchPayload && geoLocalePatchDescriptor.url) {
          const geoLocalePatchResult = await loadOptionalScenarioResource(d3Client, geoLocalePatchDescriptor.url, {
            scenarioId: targetId,
            resourceLabel: geoLocalePatchDescriptor.localeSpecific
              ? `geo_locale_patch_${geoLocalePatchDescriptor.language}`
              : "geo_locale_patch",
          });
          bundle.geoLocalePatchPayload = normalizeScenarioGeoLocalePatchPayload(geoLocalePatchResult.value);
          bundle.loadDiagnostics.optionalResources.geo_locale_patch = {
            ok: !!geoLocalePatchResult.ok,
            reason: geoLocalePatchResult.reason,
            errorMessage: geoLocalePatchResult.errorMessage,
            language: geoLocalePatchDescriptor.language,
            localeSpecific: geoLocalePatchDescriptor.localeSpecific,
            metrics: geoLocalePatchResult.metrics || null,
          };
          if (bundle.geoLocalePatchPayload) {
            if (geoLocalePatchDescriptor.localeSpecific) {
              bundle.geoLocalePatchPayloadsByLanguage[geoLocalePatchDescriptor.language] = bundle.geoLocalePatchPayload;
            } else {
              bundle.geoLocalePatchPayloadsByLanguage.en = bundle.geoLocalePatchPayload;
              bundle.geoLocalePatchPayloadsByLanguage.zh = bundle.geoLocalePatchPayload;
            }
            if (scenarioBootstrapLocaleCacheKey) {
              void writeStartupCacheEntry({
                kind: STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_LOCALE,
                cacheKey: scenarioBootstrapLocaleCacheKey,
                payload: createSerializableStartupScenarioBootstrapLocalePayload({
                  manifest,
                  bundleLevel: requestedBundleLevel,
                  language: state.currentLanguage,
                  geoLocalePatchPayload: bundle.geoLocalePatchPayload,
                }),
                keyParts: {
                  scenarioId: targetId,
                  bundleLevel: requestedBundleLevel,
                  role: "locale",
                  language: state.currentLanguage,
                },
              }).catch((error) => {
                console.warn(`[scenario] Startup bootstrap locale cache write failed for "${targetId}".`, error);
              });
            }
          }
        }
        bundle.runtimeShell = runtimeShell;
        if (requestedBundleLevel === "full" && scenarioSupportsChunkedRuntime(bundle)) {
          await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
        }
        state.scenarioBundleCacheById[targetId] = bundle;
        recordScenarioPerfMetric(
          "loadScenarioBundle",
          (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt,
          {
            scenarioId: targetId,
            cacheHit: true,
            persistentCacheHit: true,
            bundleLevel: requestedBundleLevel,
            hydratedLevel: normalizeScenarioBundleLevel(bundle.bundleLevel),
          }
        );
        return bundle;
      }
      setStartupScenarioBootstrapCacheStatus(state, "miss");
    } catch (error) {
      console.warn(`[scenario] Startup bootstrap cache read failed for "${targetId}".`, error);
      setStartupScenarioBootstrapCacheStatus(state, "error");
    }
    return null;
  }

  function queueBootstrapBundleCacheWrite({
    targetId,
    requestedBundleLevel,
    manifest,
    bundle,
    scenarioBootstrapCoreCacheKey,
    scenarioBootstrapLocaleCacheKey,
  }) {
    if (!(scenarioBootstrapCoreCacheKey && requestedBundleLevel === "bootstrap")) {
      return;
    }
    if (hasScenarioRuntimeShellContract({
      runtimeTopologyPayload: bundle.runtimeTopologyPayload,
      runtimePoliticalMeta: bundle.runtimePoliticalMeta,
    })) {
      setStartupScenarioBootstrapCacheStatus(state, "write-pending");
      const cacheWrites = [
        writeStartupCacheEntry({
          kind: STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_CORE,
          cacheKey: scenarioBootstrapCoreCacheKey,
          payload: createSerializableStartupScenarioBootstrapCorePayload({
            manifest,
            bundleLevel: requestedBundleLevel,
            countriesPayload: bundle.countriesPayload,
            ownersPayload: bundle.ownersPayload,
            coresPayload: bundle.coresPayload,
            runtimeTopologyPayload: bundle.runtimeTopologyPayload,
            runtimePoliticalMeta: bundle.runtimePoliticalMeta,
            source: bundle.source || bundle.manifest?.source || null,
          }),
          keyParts: {
            scenarioId: targetId,
            bundleLevel: requestedBundleLevel,
            role: "core",
          },
        }),
      ];
      if (scenarioBootstrapLocaleCacheKey && bundle.geoLocalePatchPayload) {
        cacheWrites.push(writeStartupCacheEntry({
          kind: STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_LOCALE,
          cacheKey: scenarioBootstrapLocaleCacheKey,
          payload: createSerializableStartupScenarioBootstrapLocalePayload({
            manifest,
            bundleLevel: requestedBundleLevel,
            language: state.currentLanguage,
            geoLocalePatchPayload: bundle.geoLocalePatchPayload,
          }),
          keyParts: {
            scenarioId: targetId,
            bundleLevel: requestedBundleLevel,
            role: "locale",
            language: state.currentLanguage,
          },
        }));
      }
      void Promise.allSettled(cacheWrites).then((results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) {
          throw rejected.reason;
        }
        setStartupScenarioBootstrapCacheStatus(state, "written");
      }).catch((error) => {
        console.warn(`[scenario] Startup bootstrap cache write failed for "${targetId}".`, error);
        setStartupScenarioBootstrapCacheStatus(state, "write-error");
      });
      return;
    }
    setStartupScenarioBootstrapCacheStatus(state, "skipped-incomplete");
  }

  async function loadScenarioBundle(
    scenarioId,
    {
      d3Client = globalThis.d3,
      forceReload = false,
      bundleLevel = "full",
    } = {}
  ) {
    const loadStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    const targetId = normalizeScenarioId(scenarioId);
    const requestedBundleLevel = normalizeScenarioBundleLevel(bundleLevel);
    if (!targetId) {
      throw new Error("Scenario id is required.");
    }
    const bundleLoadKey = buildBundleLoadKey({
      targetId,
      requestedBundleLevel,
      currentLanguage: state.currentLanguage,
      runtimeShellVersion: state.scenarioRuntimeShellVersion,
    });
    const cachedBundle = state.scenarioBundleCacheById?.[targetId] || null;
    if (!forceReload && cachedBundle && scenarioBundleSatisfiesLevel(cachedBundle, requestedBundleLevel)) {
      retainBundleInCache(targetId, cachedBundle);
      if (normalizeScenarioBundleLevel(cachedBundle.bundleLevel) === "full" && !scenarioBundleUsesChunkedLayer(cachedBundle)) {
        prewarmScenarioOptionalLayersOnCacheHit(cachedBundle, { d3Client });
      }
      recordScenarioPerfMetric(
        "loadScenarioBundle",
        (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt,
        {
          scenarioId: targetId,
          cacheHit: true,
          bundleLevel: requestedBundleLevel,
          hydratedLevel: normalizeScenarioBundleLevel(cachedBundle.bundleLevel),
        }
      );
      return cachedBundle;
    }
    if (!forceReload && bundleLoadPromisesByKey.has(bundleLoadKey)) {
      return bundleLoadPromisesByKey.get(bundleLoadKey);
    }
    const loadPromise = (async () => {
      await loadScenarioRegistry({ d3Client });
      const meta = getScenarioMetaById(targetId);
      if (!meta?.manifest_url) {
        throw new Error(`Unknown scenario id: ${targetId}`);
      }
      if (!d3Client || typeof d3Client.json !== "function") {
        throw new Error("d3.json is not available for scenario loading.");
      }
      const manifestResult = await loadScenarioJsonResourceWithTimeout(d3Client, meta.manifest_url, {
        scenarioId: targetId,
        resourceLabel: "manifest",
      });
      const manifest = manifestResult.payload;
      const priorBundle = !forceReload && cachedBundle ? cachedBundle : null;
      const geoLocalePatchDescriptor = getScenarioGeoLocalePatchDescriptor(manifest);
      const runtimeShell = normalizeScenarioRuntimeShell(manifest);
      // Chunked runtime scenarios keep the apply/startup political topology on the
      // lightweight bootstrap shell. Detail topology is promoted by chunk runtime
      // after interaction demand, which keeps exact-after-settle redraw bounded.
      const runtimeTopologyLevel = requestedBundleLevel === "bootstrap" || runtimeShell?.detailChunkManifestUrl
        ? "bootstrap"
        : "full";
      const runtimeTopologyUrl = String(
        runtimeTopologyLevel === "bootstrap"
          ? runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || manifest.runtime_topology_url || ""
          : manifest.runtime_topology_url || runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || ""
      ).trim();
      const scenarioBootstrapCoreCacheKey =
        requestedBundleLevel === "bootstrap" && isStartupCacheEnabled()
          ? createStartupScenarioBootstrapCoreCacheKey({
            scenarioRegistry: state.scenarioRegistry,
            scenarioId: targetId,
            bundleLevel: requestedBundleLevel,
            manifest,
            runtimeBootstrapTopologyUrl: runtimeTopologyUrl,
          })
          : "";
      const scenarioBootstrapLocaleCacheKey =
        requestedBundleLevel === "bootstrap" && isStartupCacheEnabled() && geoLocalePatchDescriptor.url
          ? createStartupScenarioBootstrapLocaleCacheKey({
            scenarioRegistry: state.scenarioRegistry,
            scenarioId: targetId,
            bundleLevel: requestedBundleLevel,
            manifest,
            currentLanguage: state.currentLanguage,
            geoLocalePatchUrl: geoLocalePatchDescriptor.url,
          })
          : "";
      if (requestedBundleLevel === "bootstrap") {
        setStartupScenarioBootstrapCacheStatus(
          state,
          scenarioBootstrapCoreCacheKey ? "probe" : "disabled",
        );
      }
      const cachedBootstrapBundle = await tryLoadBootstrapBundleFromPersistentCache({
        d3Client,
        targetId,
        requestedBundleLevel,
        priorBundle,
        meta,
        manifest,
        runtimeShell,
        runtimeTopologyUrl,
        runtimeTopologyLevel,
        geoLocalePatchDescriptor,
        scenarioBootstrapCoreCacheKey,
        scenarioBootstrapLocaleCacheKey,
        loadStartedAt,
      });
      if (cachedBootstrapBundle) {
        return cachedBootstrapBundle;
      }
      const {
        bundle,
        countriesResult,
        ownersResult,
        coresResult,
        runtimeTopologyResult,
        geoLocalePatchResult,
        ownerCount,
        countryCount,
      } = await assembleScenarioBundle({
        d3Client,
        targetId,
        requestedBundleLevel,
        meta,
        manifest,
        priorBundle,
        runtimeShell,
        runtimeTopologyUrl,
        runtimeTopologyLevel,
        geoLocalePatchDescriptor,
      });
      void countriesResult;
      void ownersResult;
      void coresResult;
      bundle.loadDiagnostics.requiredResources.manifest = manifestResult.metrics || null;
      if (requestedBundleLevel === "full") {
        if (scenarioSupportsChunkedRuntime(bundle)) {
          await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
        }
        scheduleScenarioDeferredBundleMetadataLoad(bundle, { d3Client });
      }
      const runtimeTopologyEquivalentMs =
        Number(runtimeTopologyResult.metrics?.totalMs || runtimeTopologyResult.metrics?.durationMs || 0)
        + Number(bundle.chunkRegistryLoadMetrics?.detailChunkManifest?.totalMs || bundle.chunkRegistryLoadMetrics?.detailChunkManifest?.durationMs || 0)
        + Number(bundle.chunkRegistryLoadMetrics?.runtimeMeta?.totalMs || bundle.chunkRegistryLoadMetrics?.runtimeMeta?.durationMs || 0)
        + Number(bundle.chunkRegistryLoadMetrics?.meshPack?.totalMs || bundle.chunkRegistryLoadMetrics?.meshPack?.durationMs || 0);
      console.log(
        `[scenario] Loaded ${requestedBundleLevel} bundle "${targetId}": ${ownerCount} owner entries, ${countryCount} countries, baseline=${String(manifest?.baseline_hash || "").slice(0, 12)}`
      );
      state.scenarioBundleCacheById[targetId] = bundle;
      retainBundleInCache(targetId, bundle);
      queueBootstrapBundleCacheWrite({
        targetId,
        requestedBundleLevel,
        manifest,
        bundle,
        scenarioBootstrapCoreCacheKey,
        scenarioBootstrapLocaleCacheKey,
      });
      recordScenarioPerfMetric("loadScenarioBundle", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt, {
        scenarioId: targetId,
        cacheHit: false,
        bundleLevel: requestedBundleLevel,
        countryCount,
        ownerCount,
        workerDecodeMs: Number(runtimeTopologyResult.workerMetrics?.runtimePoliticalTopology?.totalMs || 0),
        workerMetaBuildMs: Number(runtimeTopologyResult.workerMetrics?.runtimePoliticalMeta?.buildMs || 0),
        runtimeTopologyDecodePath: String(runtimeTopologyResult.reason || "main-thread"),
        resourceMetrics: {
          manifest: manifestResult.metrics || null,
          runtimeTopology: runtimeTopologyResult.metrics || null,
          geoLocalePatch: geoLocalePatchResult.metrics || null,
          chunkRegistry: bundle.chunkRegistryLoadMetrics || null,
        },
      });
      recordScenarioPerfMetric("runtimeTopologyEquivalent", runtimeTopologyEquivalentMs, {
        scenarioId: targetId,
        bundleLevel: requestedBundleLevel,
        runtimeTopologyDecodePath: String(runtimeTopologyResult.reason || "main-thread"),
        hasChunkedRuntime: scenarioBundleHasChunkedData(bundle),
      });
      return bundle;
    })();
    if (!forceReload) {
      bundleLoadPromisesByKey.set(bundleLoadKey, loadPromise);
    }
    try {
      return await loadPromise;
    } finally {
      if (!forceReload) {
        bundleLoadPromisesByKey.delete(bundleLoadKey);
      }
    }
  }

  return {
    loadScenarioBundle,
    trimScenarioBundleCaches: () => trimScenarioBundleCache(
      state, bundleCacheRecency, normalizeScenarioId(state.activeScenarioId),
    ),
  };
}

export {
  createScenarioBundleRuntimeController,
};
