const CORE_TAG_CACHE_LIMIT = 512;
const CORE_TAG_CACHE_MAX_LENGTH = 512;

// Cache only immutable scalar normalization, not the mutable assignment lists.
// FIFO keeps lookup cheap; all retained keys and values are bounded strings.
export function createScenarioCoreArrayNormalizer(normalizeTag) {
  const cache = new Map();
  function normalizeCachedTag(value) {
    if (typeof value !== "string" || value.length > CORE_TAG_CACHE_MAX_LENGTH) {
      return normalizeTag(value);
    }
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    const tag = normalizeTag(value);
    cache.set(value, tag);
    if (cache.size > CORE_TAG_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return tag;
  }
  return function normalizeCoreArray(values) {
    if (values.length === 1) {
      const tag = normalizeCachedTag(values[0]);
      return tag ? [tag] : [];
    }
    const seen = new Set();
    const tags = [];
    values.forEach((entry) => {
      const tag = normalizeCachedTag(entry);
      if (!tag || seen.has(tag)) return;
      seen.add(tag);
      tags.push(tag);
    });
    return tags;
  };
}
