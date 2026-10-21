// Coordinates are registered offline to the native HGO pixel map.
export const landformLabelsVisible = layers =>
  layers.terrain === true && layers.terrainMode !== 'native' && layers.landformLabels === true;

export function validateLandformLabels(value,dataset) {
  const fail=ok=>{if(!ok)throw new Error('Invalid landform labels');};
  fail(value?.schemaVersion===1&&value.coordinateSpace==='hgo-pixel'
    &&Array.isArray(value.labels)&&value.labels.length<=2048);
  const {width,height}=dataset.manifest.coordinateSpace,ids=new Set();
  for(const label of value.labels){
    fail(label&&typeof label.id==='string'&&label.id.length>0&&label.id.length<=128&&!ids.has(label.id));
    ids.add(label.id);
    fail(typeof label.nameEn==='string'&&label.nameEn.trim().length>0&&label.nameEn.length<=200
      &&typeof label.nameZh==='string'&&label.nameZh.length<=200);
    fail(Number.isFinite(label.x)&&Number.isFinite(label.y)&&label.x>=0&&label.x<width&&label.y>=0&&label.y<height);
    fail(Number.isInteger(label.rank)&&label.rank>=1&&label.rank<=10
      &&Number.isFinite(label.minZoom)&&label.minZoom>=0&&label.minZoom<=32);
  }
  return value;
}

export function landformName(source,language) {
  const en=source.nameEn.trim(),zh=source.nameZh.trim();
  return language==='bilingual'&&zh&&zh!==en?`${zh} / ${en}`:language==='en'?en:zh||en;
}
