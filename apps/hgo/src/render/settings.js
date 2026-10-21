import {METRIC_DEFINITIONS} from '../data/metrics.js';

export const DEFAULT_LAYERS = Object.freeze({
  borders:true, labels:true, cities:true,
  borderWidth:0.7, borderColor:'#1f2933', borderOpacity:0.45, labelDensity:'medium',
  nameLanguage:'zh', baseMapStyle:'political', terrain:false, landformLabels:true, rivers:false, nightLights:false, dayNight:false,
  terrainOpacity:0.35, terrainMode:'combined', quality:'balanced', riverOpacity:0.8, riverWidth:1, nightLightOpacity:0.85,
  nightOpacity:0.72, twilightWidth:10, solarMode:'manual', solarDate:'2026-06-21',
  utcMinutes:720, cycleSeconds:120, textureOpacity:0,
  metric:'none', metricOpacity:0.65
});

export const LAYER_SWITCHES = Object.freeze(['borders','labels','cities','terrain','landformLabels','rivers','nightLights','dayNight']);
export const METRIC_IDS = Object.freeze(['none',...METRIC_DEFINITIONS.map(item=>item.id)]);

export function validDisplayOption(name,value) {
  if (name==='borderWidth') return Number.isFinite(value)&&value>=0&&value<=2;
  if (name==='borderOpacity') return Number.isFinite(value)&&value>=0&&value<=1;
  if (name==='borderColor') return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  if (name==='labelDensity') return ['low','medium','high'].includes(value);
  if (name==='nameLanguage') return ['zh','en','bilingual'].includes(value);
  if (name==='baseMapStyle') return ['political','thematic'].includes(value);
  if (name==='terrainMode') return ['native','geomorphology','combined'].includes(value);
  if (name==='quality') return ['balanced','fine'].includes(value);
  if (LAYER_SWITCHES.includes(name)) return typeof value==='boolean';
  if (['terrainOpacity','riverOpacity','nightLightOpacity','nightOpacity','textureOpacity','metricOpacity'].includes(name)) return Number.isFinite(value)&&value>=0&&value<=1;
  if (name==='riverWidth') return Number.isFinite(value)&&value>=0.5&&value<=3;
  if (name==='twilightWidth') return Number.isFinite(value)&&value>=2&&value<=28;
  if (name==='utcMinutes') return Number.isInteger(value)&&value>=0&&value<1440;
  if (name==='cycleSeconds') return Number.isFinite(value)&&value>=30&&value<=600;
  if (name==='solarMode') return ['manual','utc','cycle'].includes(value);
  if (name==='solarDate') return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
  if (name==='metric') return METRIC_IDS.includes(value);
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
