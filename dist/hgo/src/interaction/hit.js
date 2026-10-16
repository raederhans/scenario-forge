export function hitTest(dataset, x, y) {
  const {width,height} = dataset.manifest.coordinateSpace;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) return null;
  const code = dataset.ids[Math.floor(y) * width + Math.floor(x)];
  if (!code) return null;
  return {code,provinceId:dataset.core.provinceIds[code],stateId:String(dataset.core.provinceStateIds[code])};
}
