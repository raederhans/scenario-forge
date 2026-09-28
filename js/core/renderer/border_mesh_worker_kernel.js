import { buildSourceBorderMeshes } from "./border_mesh_source_selection.js";
import { buildDetailAdmBorderMesh } from "./border_mesh_dynamic_runtime.js";
import { unpackTopologyFromTransfer } from "../topology_transfer_codec.js";

export function createBorderMeshWorkerKernel() {
  const sources = new Map();
  const usable = (mesh) => !!mesh?.coordinates?.length;
  function registerSource({ sourceKey, sourceSignature, topology, topologyArcs, geometryPolicy }) {
    if (topologyArcs) topology = unpackTopologyFromTransfer(topology, topologyArcs);
    if (!sourceKey || !sourceSignature || !topology?.objects?.political) throw new Error("Invalid border source.");
    const geometries = [];
    const visit = (geometry) => geometry?.type === "GeometryCollection"
      ? (geometry.geometries || []).forEach(visit) : geometry && geometries.push(geometry);
    visit(topology.objects.political);
    if (!Array.isArray(geometryPolicy) || geometryPolicy.length !== geometries.length) throw new Error("Border policy geometry count mismatch.");
    const source = { sourceSignature, topology,
      policy: new WeakMap(geometries.map((geometry, index) => [geometry, geometryPolicy[index]])) };
    source.country = (geometry) => source.policy.get(geometry)?.countryCode || "";
    sources.set(sourceKey, source);
    return { sourceKey, sourceSignature };
  }
  function updatePolicy({ sourceKey, sourceSignature, geometryPolicy }) {
    const source = sources.get(sourceKey);
    if (!source) throw new Error("Stale or missing border source.");
    const geometries = [];
    const visit = (geometry) => geometry?.type === "GeometryCollection"
      ? (geometry.geometries || []).forEach(visit) : geometry && geometries.push(geometry);
    visit(source.topology.objects.political);
    if (!Array.isArray(geometryPolicy) || geometryPolicy.length !== geometries.length) throw new Error("Border policy geometry count mismatch.");
    source.policy = new WeakMap(geometries.map((geometry, index) => [geometry, geometryPolicy[index]]));
    source.sourceSignature = sourceSignature;
    return { sourceKey, sourceSignature };
  }
  function build({ sourceKey, sourceSignature, countries = [], kind = "country", includeProvince = true, includeLocal = true }) {
    const source = sources.get(sourceKey);
    if (!source || source.sourceSignature !== sourceSignature) throw new Error("Stale or missing border source.");
    const { topology, policy, country } = source;
    const common = { topology, includedCountries: new Set(countries), asFeatureLike: (value) => value,
      shouldExcludePoliticalInteractionFeature: (geometry) => !!policy.get(geometry)?.excluded };
    if (kind === "detail") return { mesh: buildDetailAdmBorderMesh({ ...common,
      getEntityCountryCode: country, isAdmDetailTier: (geometry) => !!policy.get(geometry)?.isAdmDetailTier }) };
    if (kind !== "country") throw new Error("Unknown border mesh kind.");
    const result = buildSourceBorderMeshes({ ...common, getFeatureCountryCodeNormalized: country,
      countryAssignmentRevision: sourceSignature, getAdmin1Group: (geometry) => policy.get(geometry)?.admin1Group || "",
      isUsableMesh: usable, includeProvince, includeLocal });
    const output = result || { provinceMeshes: [], localMeshes: [], provinceMeshesByCountry: new Map(), localMeshesByCountry: new Map() };
    for (const code of countries) {
      if (includeProvince && !output.provinceMeshesByCountry.has(code)) output.provinceMeshesByCountry.set(code, []);
      if (includeLocal && !output.localMeshesByCountry.has(code)) output.localMeshesByCountry.set(code, []);
    }
    return output;
  }
  return { registerSource, updatePolicy, build, clear: () => sources.clear() };
}
