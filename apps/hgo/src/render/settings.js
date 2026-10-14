export const DEFAULT_LAYERS = Object.freeze({
  borders:true, labels:true, cities:true,
  borderWidth:0.7, borderColor:'#1f2933', borderOpacity:0.45, labelDensity:'medium'
});

export function validDisplayOption(name,value) {
  if (name==='borderWidth') return Number.isFinite(value)&&value>=0&&value<=2;
  if (name==='borderOpacity') return Number.isFinite(value)&&value>=0&&value<=1;
  if (name==='borderColor') return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  if (name==='labelDensity') return ['low','medium','high'].includes(value);
  return false;
}

export function readLayers(value) {
  if (!value||typeof value!=='object'||Array.isArray(value)||
      !['borders','labels','cities'].every(k=>typeof value[k]==='boolean')||
      Object.keys(value).some(k=>!['borders','labels','cities'].includes(k)&&!validDisplayOption(k,value[k]))) {
    throw new Error('Invalid project layers');
  }
  return {...DEFAULT_LAYERS,...value};
}
