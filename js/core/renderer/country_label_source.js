import { getMapDataBoundary } from '../map_data_boundary.js';
import { getCountryNameOverride } from '../country_name_overrides.js';
import { getFeatureId } from '../feature_identity.js';
import { getObjectIdentityToken } from './object_identity.js';
import { getParentMergedParents } from './parent_merged_presentation.js';
import { createWorkerTaskClient } from '../worker_task_client.js';
import { packGeometryCooperatively } from '../cooperative_geometry_transport.js';
import { getCountryLabelPolygons as polygons, mergeCountryLabelGroups, unpackCountryLabelTransport } from './country_label_geometry.js';
import { yieldToBackground } from "../background_yield.js";

const EMPTY = Object.freeze([]);
const text = value => String(value ?? '').trim();
function sameAssignments(a, b) {
  if (a === b) return true;
  if (!a || a.size !== b.size) return false;
  for (const [id, code] of b) if (a.get(id) !== code) return false;
  return true;
}
function freezeMap(map) {
  const reject = () => { throw new TypeError('Country label membership is read-only'); };
  return Object.freeze(Object.assign(map, { set: reject, delete: reject, clear: reject }));
}
function eligible(feature) {
  const props = feature?.properties || {}, id = getFeatureId(feature);
  return !props.water_type && !/water|ocean|marine|sea/.test(text(props.geometry_role).toLowerCase())
    && text(props.detail_tier).toLowerCase() !== 'antarctic_sector'
    && !id.toUpperCase().includes('_FB_') && !/shell fallback/i.test(text(props.name))
    && props.render_as_base_geography !== true;
}

export function createCountryLabelSourceOwner({ state, topojson = globalThis.topojson, geoArea = globalThis.d3?.geoArea,
  geoContains = globalThis.d3?.geoContains, geoBounds = globalThis.d3?.geoBounds,
  ensureSources, getCountryName = code => getCountryNameOverride(state, code) || state.countryNames?.[code] || code,
  resolveBorderIdentity, isMembershipEditSettled, membershipScheduler,
  nowMs = () => performance.now(), recordRenderPerfMetric,
  isEligible = () => true, onChange = () => {},
  createWorker = () => new Worker(new URL('../../workers/country_label_geometry.worker.js', import.meta.url), { type: 'module' }),
  isWorkerSupported = () => typeof Worker === 'function',
  yieldTask = yieldToBackground } = {}) {
  const reference = getMapDataBoundary(state).reference;
  let sourceToken = '', revision = 0, status = 'pending', error = '';
  let geometryRecords = EMPTY, countries = EMPTY, features = EMPTY, nameKey = '';
  let memberIndex = null;
  let publishedAssignments = null, paintKey = [], assignments = new Map(), assignmentRevision = 0;
  let membershipError = '', failedAssignmentRevision = null;
  const debounce = isMembershipEditSettled && membershipScheduler;
  let gate = null, timer = null;
  let retained = null, request = null, buildRequest = null, failedIdentity = null, disposed = false;
  async function buildGroups(groups, c, signal, client) {
    const isCurrent = () => !disposed && !signal.aborted && context().world === c.world;
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
    const world = JSON.stringify([scenarioId, state.sceneGeneration || 0,
      getObjectIdentityToken(bundle), getObjectIdentityToken(bundle?.chunkRegistry),
      bases.map(({ id, sha256, url }) => [id, sha256, url]),
      chunked ? '' : getObjectIdentityToken(topology),
      getObjectIdentityToken(state.scenarioBaselineOwnersByFeatureId), state.scenarioBaselineHash || '',
      // Only the child→parent label grouping matters; other country edits must
      // not re-dissolve every country outline.
      [...getParentMergedParents(state.scenarioCountriesByTag)],
      state.mapSemanticMode || '']);
    return { scenarioId, bundle, chunked, bases, topology, world };
  }

  function scanAssignments(c) {
    const key = [memberIndex, state.colorRevision, state.visualOverrides, state.sovereignBaseColors, state.scenarioCountriesByTag];
    if (c.scenarioId && resolveBorderIdentity && memberIndex && key.some((value, i) => value !== paintKey[i])) {
      const started = nowMs();
      paintKey = key;
      const next = new Map();
      const parents = getParentMergedParents(state.scenarioCountriesByTag);
      for (const id of Object.keys(state.visualOverrides || {})) {
        const original = memberIndex.groupCodeById.get(id);
        if (!original) continue;
        const resolved = resolveBorderIdentity(id, state.landIndex?.get(id));
        const code = parents.get(resolved) || resolved;
        if (state.scenarioCountriesByTag?.[code] && !code.startsWith('color:') && code !== original) {
          next.set(id, code);
        }
      }
      if (!sameAssignments(assignments, next)) {
        assignments = sameAssignments(publishedAssignments, next) ? publishedAssignments : next;
        assignmentRevision++;
        if (assignments === publishedAssignments) {
          clearGate();
        } else if (debounce && publishedAssignments) {
          const now = nowMs();
          gate = { quietUntil: now + 250, deadline: gate?.deadline ?? now + 2000 };
        }
      }
      recordRenderPerfMetric?.('countryLabelMembershipScan', nowMs() - started);
    }
    c.assignments = assignments;
    c.assignmentRevision = assignmentRevision;
  }

  function currentNameKey() {
    return JSON.stringify([state.currentLanguage, getObjectIdentityToken(state.scenarioCountriesByTag),
      getObjectIdentityToken(state.countryNames), getObjectIdentityToken(state.locales?.geo),
      getObjectIdentityToken(state.countryNameOverrides),
      getObjectIdentityToken(state.geoAliasToStableKey)]);
  }

  function publishNames(records = geometryRecords) {
    const next = currentNameKey();
    if (next === nameKey && records === geometryRecords) return;
    const previous = new Map(countries.map(country => [country.countryCode, country]));
    countries = records.map(({ countryCode, geometry }) => {
      const name = text(getCountryName(countryCode)) || countryCode;
      const existing = previous.get(countryCode);
      if (existing?.geometry === geometry && existing.name === name) return existing;
      const feature = { type: 'Feature', id: countryCode, properties: { countryCode, label: name }, geometry };
      return { countryCode, name, feature, geometry };
    });
    features = countries.map(country => country.feature);
    nameKey = next;
    geometryRecords = records;
  }

  function clearGate() {
    if (timer !== null) membershipScheduler.clearTimeout(timer);
    timer = gate = null;
  }

  function gateOpen() {
    if (!debounce) return true;
    if (!gate) return false;
    const now = nowMs();
    return now >= gate.deadline || (now >= gate.quietUntil && isMembershipEditSettled());
  }

  function waitForQuiet() {
    if (!debounce) return false;
    const now = nowMs();
    gate ??= { quietUntil: now + 250, deadline: now + 2000 };
    if (gateOpen()) return false;
    if (timer === null) {
      const wake = Math.min(gate.deadline, gate.quietUntil > now ? gate.quietUntil : now + 250);
      timer = membershipScheduler.setTimeout(() => {
        timer = null;
        sync();
        if (buildRequest) onChange();
      }, wake - now);
    }
    return true;
  }

  function sync() {
    if (disposed) return;
    const c = context();
    if (buildRequest && buildRequest.world !== c.world) {
      buildRequest.controller.abort();
      buildRequest.client.terminate(new DOMException('Country label scene replaced', 'AbortError'));
      buildRequest = null;
    }
    if (sourceToken !== c.world) {
      sourceToken = c.world; revision++; status = 'pending'; error = '';
      geometryRecords = countries = features = EMPTY; nameKey = '';
      memberIndex = null;
      clearGate();
      assignments = new Map(); paintKey = [];
      membershipError = ''; failedAssignmentRevision = null;
      publishedAssignments = null;
      if (retained?.world !== c.world) retained = null;
    }
    if (c.scenarioId === 'blank_base' || state.mapSemanticMode === 'blank') { status = 'disabled'; return; }
    scanAssignments(c);
    if (failedIdentity?.world === c.world && failedIdentity.assignmentRevision === assignmentRevision) {
      status = 'error';
      return;
    }
    error = '';
    status = publishedAssignments ? 'ready' : 'pending';
    if (publishedAssignments) publishNames();
    if (buildRequest) return;
    if (publishedAssignments) {
      if (failedAssignmentRevision !== assignmentRevision) {
        membershipError = ''; failedAssignmentRevision = null;
      }
      if (publishedAssignments === assignments || failedAssignmentRevision === assignmentRevision) {
        clearGate();
        return;
      }
      if (waitForQuiet()) return;
    }
    let input;
    if (!publishedAssignments && c.chunked) {
      if (!c.bases.length) return;
      input = retained?.payloads || c.bases.map(({ id }) => c.bundle?.chunkPayloadCacheById?.[id]?.payload
        || state.activeScenarioChunks?.payloadByChunkId?.[id]?.payload);
      if (input.length !== c.bases.length || input.some(payload => !Array.isArray(payload?.features))) return;
    } else if (!c.chunked && !c.topology?.objects?.political) return;
    if (typeof topojson?.merge !== 'function') return;
    const owned = { world: c.world, controller: new AbortController(),
      forced: gate && nowMs() >= gate.deadline,
      client: createWorkerTaskClient({ createWorker, resolveMessage: message => unpackCountryLabelTransport(message.result) }) };
    clearGate();
    buildRequest = owned;
    // A frame only selects an immutable world source. Expensive dissolution
    // runs after it yields, and releases the main thread between countries.
    owned.promise = build(c, input, owned.controller.signal, owned.client).finally(() => {
      owned.client.terminate();
      if (buildRequest === owned) {
        buildRequest = null;
        sync();
        return buildRequest?.promise;
      }
    });
  }

  function changedCountries(previous, next) {
    const changed = new Set();
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const original = memberIndex.groupCodeById.get(id);
      const before = previous.get(id) || original, after = next.get(id) || original;
      if (before !== after) { changed.add(before); changed.add(after); }
    }
    return changed;
  }

  function groupWorld(c, input) {
    const groups = new Map(), seen = new Set();
    const groupCodeById = new Map(), featureById = new Map(), memberCountByCode = new Map();
    const parents = getParentMergedParents(state.scenarioCountriesByTag);
    const add = feature => {
      const id = getFeatureId(feature);
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      if (!eligible(feature) || !isEligible(feature, id)) return;
      // Scenario reference is complete and immutable. Never borrow geographic
      // identity when a historical scenario has not assigned this feature.
      const ownerCode = c.scenarioId ? reference.getScenarioGroupCode(id) : reference.getBaseGroupCode(feature);
      const code = parents.get(ownerCode) || ownerCode;
      if (!code) return;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(feature);
      if (id) {
        groupCodeById.set(id, code);
        featureById.set(id, feature);
        memberCountByCode.set(code, (memberCountByCode.get(code) || 0) + 1);
      }
    };
    if (c.chunked) input.forEach(payload => payload.features.forEach(feature => {
      if (polygons(feature?.geometry).length) add(feature);
    }));
    else {
      const visit = geometry => {
        if (geometry?.type === 'GeometryCollection') (geometry.geometries || []).forEach(visit);
        else if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') add(geometry);
      };
      visit(c.topology.objects.political);
    }
    const members = Object.freeze({ groupCodeById: freezeMap(groupCodeById),
      featureById: freezeMap(featureById), memberCountByCode: freezeMap(memberCountByCode) });
    return { groups, members };
  }

  async function build(c, input, signal, client) {
    try {
      await yieldTask();
      if (disposed || signal.aborted || context().world !== c.world) return;
      const started = nowMs();
      let groups = new Map();
      if (!publishedAssignments) {
        const indexed = groupWorld(c, input);
        groups = indexed.groups;
        memberIndex = indexed.members;
        scanAssignments(c);
      }
      const changed = changedCountries(publishedAssignments || new Map(), c.assignments);
      let memberCount = 0;
      if (changed.size) {
        for (const code of changed) groups.delete(code);
        for (const [id, original] of memberIndex.groupCodeById) {
          const code = c.assignments.get(id) || original;
          if (!changed.has(code)) continue;
          if (!groups.has(code)) groups.set(code, []);
          groups.get(code).push(memberIndex.featureById.get(id));
          memberCount++;
        }
      }
      const updates = groups.size ? await buildGroups(groups, c, signal, client) : [];
      if (disposed || signal.aborted || context().world !== c.world) return;
      publishNames(geometryRecords.filter(record => !changed.has(record.countryCode)).concat(updates));
      if (publishedAssignments) {
        revision++;
        recordRenderPerfMetric?.('countryLabelMembershipBuild', nowMs() - started, { changedCountryCount: changed.size, memberCount });
      }
      publishedAssignments = sameAssignments(c.assignments, assignments) ? assignments : c.assignments;
      membershipError = ''; failedAssignmentRevision = null;
      status = 'ready'; retained = null; onChange();
    } catch (failure) {
      if (disposed || signal.aborted || context().world !== c.world) return;
      if (publishedAssignments) {
        membershipError = text(failure?.message || failure); failedAssignmentRevision = c.assignmentRevision;
      } else {
        status = 'error'; error = text(failure?.message || failure);
        failedIdentity = { world: c.world, assignmentRevision: c.assignmentRevision };
      }
      onChange();
    }
  }

  async function prepare() {
    sync();
    const c = context();
    if (buildRequest) return buildRequest.promise;
    if (disposed || status !== 'pending' || !c.chunked || !c.bundle || typeof ensureSources !== 'function') return;
    if (request?.world === c.world) return request.promise;
    const owned = { world: c.world, scenarioId: c.scenarioId, bundle: c.bundle,
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
      retained = { world: current.world, payloads };
      sync();
      return buildRequest?.promise;
    }).catch(failure => {
      const current = context();
      if (disposed || request !== owned || state.activeScenarioId !== owned.scenarioId
        || state.sceneGeneration !== owned.generation || current.bundle !== owned.bundle
        || (owned.registry && owned.registry !== owned.bundle.chunkRegistry)) return;
      sourceToken = current.world; failedIdentity = { world: current.world, assignmentRevision };
      status = 'error'; error = text(failure?.message || failure); onChange();
    }).finally(() => { if (request === owned) request = null; });
    return owned.promise;
  }

  function membershipPending() {
    if (disposed || failedAssignmentRevision === assignmentRevision) return false;
    if (buildRequest) return !debounce || !publishedAssignments || !!buildRequest.forced || isMembershipEditSettled();
    return !!publishedAssignments && publishedAssignments !== assignments && gateOpen();
  }

  return Object.freeze({
    getSource() { sync(); return { status, sourceToken, revision, features, countries, memberIndex, error,
      membershipError, failedAssignmentRevision, membershipPending: membershipPending() }; },
    // Acceptance observers may inspect completion without selecting a source,
    // loading chunks, or starting/replacing a geometry worker.
    peekSource() {
      const c = context();
      const disabled = c.scenarioId === 'blank_base' || state.mapSemanticMode === 'blank';
      const current = sourceToken === c.world && (status !== 'ready' || nameKey === currentNameKey());
      if (current) scanAssignments(c);
      return { status: disposed ? 'disposed' : disabled ? 'disabled' : current ? status : 'pending',
        sourceToken, revision, features, countries, memberIndex: current ? memberIndex : null, error: current ? error : '',
        membershipError: current ? membershipError : '', failedAssignmentRevision: current ? failedAssignmentRevision : null,
        membershipPending: current && membershipPending() };
    },
    prepare,
    dispose() {
      clearGate();
      disposed = true; buildRequest?.controller.abort(); buildRequest?.client.terminate();
      retained = request = buildRequest = null; geometryRecords = countries = features = EMPTY;
      memberIndex = null;
      publishedAssignments = null;
    },
  });
}
