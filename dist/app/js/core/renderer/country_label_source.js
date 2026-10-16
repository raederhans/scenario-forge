import { getMapDataBoundary } from '../map_data_boundary.js';
import { getFeatureId } from '../feature_identity.js';
import { getObjectIdentityToken } from './object_identity.js';
import { createWorkerTaskClient } from '../worker_task_client.js';
import { packGeometryCooperatively } from '../cooperative_geometry_transport.js';
import { getCountryLabelPolygons as polygons, mergeCountryLabelGroups, unpackCountryLabelTransport } from './country_label_geometry.js';

const EMPTY = Object.freeze([]);
const text = value => String(value ?? '').trim();
function eligible(feature) {
  const props = feature?.properties || {}, id = getFeatureId(feature);
  return !props.water_type && !/water|ocean|marine|sea/.test(text(props.geometry_role).toLowerCase())
    && text(props.detail_tier).toLowerCase() !== 'antarctic_sector'
    && !id.toUpperCase().includes('_FB_') && !/shell fallback/i.test(text(props.name))
    && props.render_as_base_geography !== true;
}

export function createCountryLabelSourceOwner({ state, topojson = globalThis.topojson, geoArea = globalThis.d3?.geoArea,
  geoContains = globalThis.d3?.geoContains, geoBounds = globalThis.d3?.geoBounds,
  ensureSources, getCountryName = code => state.countryNames?.[code] || code,
  isEligible = () => true, onChange = () => {},
  createWorker = () => new Worker(new URL('../../workers/country_label_geometry.worker.js', import.meta.url), { type: 'module' }),
  isWorkerSupported = () => typeof Worker === 'function',
  yieldTask = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield()
    : new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const reference = getMapDataBoundary(state).reference;
  let sourceToken = '', revision = 0, status = 'pending', error = '';
  let geometryRecords = EMPTY, countries = EMPTY, features = EMPTY, nameKey = '';
  let retained = null, request = null, buildRequest = null, failedIdentity = '', disposed = false;
  async function buildGroups(groups, c, signal, client) {
    const isCurrent = () => !disposed && !signal.aborted && context().identity === c.identity;
    if (!isWorkerSupported()) return mergeCountryLabelGroups([...groups], {
      topology: c.chunked ? null : c.topology, topojson, geoArea, geoContains, geoBounds, yieldTask, isCurrent });
    const entries = [...groups].flatMap(([countryCode, members]) => members.map(feature => ({ countryCode, feature })));
    const pack = batch => globalThis.__scenarioForgeGeometryTransferCodecShared.pack(batch, { minCoordinateCount: 0 });
    const transport = await packGeometryCooperatively(entries, { signal, yieldTask, pack });
    const arcs = c.chunked ? null : await packGeometryCooperatively([
      { type: 'MultiLineString', coordinates: c.topology.arcs },
    ], { signal, yieldTask, pack });
    if (!isCurrent()) throw new DOMException('Stale country label geometry', 'AbortError');
    return client.dispatchTask('BUILD_COUNTRY_LABELS', {
      geometryTransport: transport.payload,
      topology: c.chunked ? null : { type: 'Topology', transform: c.topology.transform },
      arcTransport: arcs?.payload || null,
    }, { signal, transfer: [...transport.transferables, ...(arcs?.transferables || [])] });
  }

  function context() {
    const scenarioId = text(state.activeScenarioId);
    const bundle = state.scenarioBundleCacheById?.[scenarioId];
    const chunked = !!scenarioId && !!(bundle?.chunkRegistry || state.activeScenarioManifest?.detail_chunk_manifest_url);
    const bases = (bundle?.chunkRegistry?.byLayer?.political || [])
      .filter(chunk => chunk.globalCoverage === true && chunk.lod === 'coarse');
    const topology = scenarioId ? state.scenarioRuntimeTopologyData : state.topologyPrimary || state.topology;
    // Immutable registry descriptors identify the world, not viewport residency.
    const identity = JSON.stringify([scenarioId, state.sceneGeneration || 0,
      getObjectIdentityToken(bundle), getObjectIdentityToken(bundle?.chunkRegistry),
      bases.map(({ id, sha256, url }) => [id, sha256, url]),
      chunked ? '' : getObjectIdentityToken(topology),
      getObjectIdentityToken(state.scenarioBaselineOwnersByFeatureId), state.scenarioBaselineHash || '',
      state.mapSemanticMode || '']);
    return { scenarioId, bundle, chunked, bases, topology, identity };
  }

  function publishNames() {
    const next = JSON.stringify([state.currentLanguage, getObjectIdentityToken(state.scenarioCountriesByTag),
      getObjectIdentityToken(state.countryNames), getObjectIdentityToken(state.locales?.geo),
      getObjectIdentityToken(state.geoAliasToStableKey)]);
    if (next === nameKey) return;
    nameKey = next;
    countries = geometryRecords.map(({ countryCode, geometry }) => {
      const name = text(getCountryName(countryCode)) || countryCode;
      const feature = { type: 'Feature', id: countryCode, properties: { countryCode, label: name }, geometry };
      return { countryCode, name, feature, geometry };
    });
    features = countries.map(country => country.feature);
  }

  function sync() {
    if (disposed) return;
    const c = context();
    if (sourceToken !== c.identity) {
      buildRequest?.controller.abort();
      buildRequest?.client.terminate(new DOMException('Country label scene replaced', 'AbortError'));
      sourceToken = c.identity; revision++; status = 'pending'; error = '';
      geometryRecords = countries = features = EMPTY; nameKey = '';
      if (retained?.identity !== c.identity) retained = null;
    }
    if (c.scenarioId === 'blank_base' || state.mapSemanticMode === 'blank') { status = 'disabled'; return; }
    if (status === 'ready') { publishNames(); return; }
    if (failedIdentity === c.identity) { status = 'error'; return; }
    let input;
    if (c.chunked) {
      if (!c.bases.length) return;
      input = retained?.payloads || c.bases.map(({ id }) => c.bundle?.chunkPayloadCacheById?.[id]?.payload
        || state.activeScenarioChunks?.payloadByChunkId?.[id]?.payload);
      if (input.length !== c.bases.length || input.some(payload => !Array.isArray(payload?.features))) return;
    } else if (!c.topology?.objects?.political) return;
    if (typeof topojson?.merge !== 'function') return;
    if (buildRequest?.identity === c.identity) return;
    const owned = { identity: c.identity, controller: new AbortController(),
      client: createWorkerTaskClient({ createWorker, resolveMessage: message => unpackCountryLabelTransport(message.result) }) };
    buildRequest = owned;
    // A frame only selects an immutable world source. Expensive dissolution
    // runs after it yields, and releases the main thread between countries.
    owned.promise = build(c, input, owned.controller.signal, owned.client).finally(() => {
      owned.client.terminate();
      if (buildRequest === owned) buildRequest = null;
    });
  }

  async function build(c, input, signal, client) {
    try {
      await yieldTask();
      if (disposed || context().identity !== c.identity) return;
      const groups = new Map(), seen = new Set();
      const add = (feature, geometry = null) => {
        const id = getFeatureId(feature);
        if (id && seen.has(id)) return;
        if (id) seen.add(id);
        if (!eligible(feature) || !isEligible(feature, id)) return;
        // Scenario reference is complete and immutable. Never borrow geographic
        // identity when a historical scenario has not assigned this feature.
        const code = c.scenarioId ? reference.getScenarioGroupCode(id) : reference.getBaseGroupCode(feature);
        if (!code) return;
        if (!groups.has(code)) groups.set(code, []);
        groups.get(code).push(geometry || feature);
      };
      if (c.chunked) input.forEach(payload => payload.features.forEach(feature => {
        if (polygons(feature?.geometry).length) add(feature);
      }));
      else {
        const visit = geometry => {
          if (geometry?.type === 'GeometryCollection') (geometry.geometries || []).forEach(visit);
          else if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') add(geometry, geometry);
        };
        visit(c.topology.objects.political);
      }
      const records = await buildGroups(groups, c, signal, client);
      if (disposed || signal.aborted || context().identity !== c.identity) return;
      geometryRecords = records;
      status = 'ready'; retained = null; publishNames(); onChange();
    } catch (failure) {
      if (disposed || context().identity !== c.identity) return;
      status = 'error'; error = text(failure?.message || failure); failedIdentity = c.identity;
      onChange();
    }
  }

  async function prepare() {
    sync();
    const c = context();
    if (buildRequest?.identity === c.identity) return buildRequest.promise;
    if (disposed || status !== 'pending' || !c.chunked || !c.bundle || typeof ensureSources !== 'function') return;
    if (request?.identity === c.identity) return request.promise;
    const owned = { identity: c.identity, scenarioId: c.scenarioId, bundle: c.bundle,
      generation: state.sceneGeneration, registry: c.bundle.chunkRegistry };
    request = owned;
    owned.promise = Promise.resolve().then(() => ensureSources(['political'])).then(result => {
      if (disposed || request !== owned || state.activeScenarioId !== owned.scenarioId
        || state.sceneGeneration !== owned.generation || context().bundle !== owned.bundle
        || (owned.registry && owned.registry !== owned.bundle.chunkRegistry)) return;
      // Runtime hook registration may follow the first draw; absence is pending,
      // not a permanent failed request. Registry discovery is allowed here.
      if (result == null) return;
      const current = context(), payloads = result.political;
      if (!current.bases.length || !Array.isArray(payloads) || payloads.length !== current.bases.length
        || payloads.some(payload => !Array.isArray(payload?.features))) throw new Error('Incomplete country label world source');
      retained = { identity: current.identity, payloads };
      sync();
      return buildRequest?.promise;
    }).catch(failure => {
      const current = context();
      if (disposed || request !== owned || state.activeScenarioId !== owned.scenarioId
        || state.sceneGeneration !== owned.generation || current.bundle !== owned.bundle
        || (owned.registry && owned.registry !== owned.bundle.chunkRegistry)) return;
      sourceToken = current.identity; failedIdentity = current.identity;
      status = 'error'; error = text(failure?.message || failure); onChange();
    }).finally(() => { if (request === owned) request = null; });
    return owned.promise;
  }

  return Object.freeze({
    getSource() { sync(); return { status, sourceToken, revision, features, countries, error }; },
    prepare,
    dispose() {
      disposed = true; buildRequest?.controller.abort(); buildRequest?.client.terminate();
      retained = request = buildRequest = null; geometryRecords = countries = features = EMPTY;
    },
  });
}
