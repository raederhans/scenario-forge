import { RIVER_PAINT_LOCATION_ROWS } from './river_paint_location_data.js';

// Keys are the named source rivers, including Huang's Yellow River alias.
export const RIVER_PAINT_RIVERS = Object.freeze({
  Danube: { en: 'Danube', zh: '多瑙河' },
  Dnieper: { en: 'Dnieper', zh: '第聂伯河' },
  Don: { en: 'Don', zh: '顿河' },
  Elbe: { en: 'Elbe', zh: '易北河' },
  Huang: { en: 'Yellow River', zh: '黄河' },
  Oder: { en: 'Oder', zh: '奥德河' },
  Rhine: { en: 'Rhine', zh: '莱茵河' },
  Seine: { en: 'Seine', zh: '塞纳河' },
  Volga: { en: 'Volga', zh: '伏尔加河' },
  Yangtze: { en: 'Yangtze', zh: '长江' },
});

const metadata = new Map(RIVER_PAINT_LOCATION_ROWS.map(([id, name, country, rivers, zh]) =>
  [id, { id, name, country, rivers, zh: zh || name }]));
const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ł/g, 'l');

function label(location, language) {
  const name = language === 'zh' ? location.zh : location.name;
  return [name, ...location.rivers.map(river => RIVER_PAINT_RIVERS[river][language]), location.country]
    .filter(Boolean).join(' · ');
}

// Metadata cannot add a parent or upgrade a self-contained saved pack. Unknown
// saved IDs remain reachable by ID, with no guessed river/country association.
export function getRiverPaintLocations(pack) {
  return (pack?.parents || []).map(parent => {
    const location = metadata.get(parent.parentId)
      || { id: parent.parentId, name: parent.parentId, zh: parent.parentId, country: '', rivers: [] };
    return { ...location, labels: { en: label(location, 'en'), zh: label(location, 'zh') } };
  });
}

export function filterRiverPaintLocations(locations, { query = '', river = '' } = {}) {
  const terms = fold(query).trim().split(/\s+/).filter(Boolean);
  return locations.filter(location => {
    if (river && !location.rivers.includes(river)) return false;
    const searchable = fold([location.id, location.name, location.zh, location.country,
      ...location.rivers.flatMap(key => [key, RIVER_PAINT_RIVERS[key].en, RIVER_PAINT_RIVERS[key].zh])].join(' '));
    return terms.every(term => searchable.includes(term));
  });
}
