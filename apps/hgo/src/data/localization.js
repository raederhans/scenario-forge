const tableFor = kind => kind === 'state' ? 'states' : ['country','entity'].includes(kind) ? 'entities' : 'places';
const keyFor = (kind, source) => String(tableFor(kind) === 'entities' ? source.tag : source.id);
const languages = new Set(['en','zh','bilingual']);

export function validateLocalization(payload, dataset) {
  if (payload?.format !== 'hgo-native-localization' || payload.schemaVersion !== 1
      || payload.dataset?.id !== dataset.manifest.id || payload.dataset?.revision !== dataset.manifest.revision) {
    throw new Error('Localization does not match this HGO dataset');
  }
  const identities = {
    states:new Map(dataset.core.states.map(source=>[String(source.id),source])),
    entities:new Map(dataset.core.entities.map(source=>[source.tag,source])),
    places:new Map((dataset.places || []).map(source=>[String(source.id),source])),
  };
  for (const table of Object.keys(identities)) {
    const entries=payload[table];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Invalid localization ${table}`);
    for (const [id, entry] of Object.entries(entries)) {
      const source=identities[table].get(id);
      if (!source || !entry || typeof entry.en !== 'string' || (!entry.en.trim() && source.name !== '')
          || entry.original !== source.name || (entry.zh !== undefined && (typeof entry.zh !== 'string' || !entry.zh.trim()))
          || (entry.aliases !== undefined && (!Array.isArray(entry.aliases) || entry.aliases.some(name=>typeof name !== 'string')))) {
        throw new Error(`Invalid localization identity ${table}:${id}`);
      }
    }
  }
  return payload;
}

export function createNameResolver(dataset, overlay) {
  const baseEntities=new Map(dataset.core.entities.map(source=>[source.tag,source]));
  function entry(kind,source) {
    const value=(overlay === undefined ? dataset.localization : overlay)?.[tableFor(kind)]?.[keyFor(kind,source)];
    return value?.original === source.name ? value : null;
  }
  function custom(kind,source,customName) {
    if (typeof customName === 'string' && customName.trim()) return customName.trim();
    // Dynamic country records carry editable names; never translate a rename.
    const base=tableFor(kind)==='entities' && baseEntities.get(source.tag);
    return base && source.name !== base.name ? String(source.name || '').trim() : '';
  }
  function name(kind,source,language='en',{customName}={}) {
    const override=custom(kind,source,customName);
    if (override) return override;
    const localized=entry(kind,source), en=localized?.en || String(source.name || '');
    const zh=localized?.zh;
    if (!languages.has(language) || language==='en' || !zh) return en;
    return language==='bilingual' && zh!==en ? `${zh} / ${en}` : zh;
  }
  function searchNames(kind,source,{customName}={}) {
    const localized=entry(kind,source);
    return [...new Set([custom(kind,source,customName),source.name,localized?.en,localized?.zh,
      ...(localized?.aliases || [])].filter(value=>typeof value==='string' && value.trim()))];
  }
  return {name,searchNames};
}
