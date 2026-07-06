type CacheEntry = { value: any; expires: number };

const OVERVIEW_CACHE_TTL_MS = 30_000;
const OVERVIEW_CACHE_MAX = 50;
const overviewCache = new Map<string, CacheEntry>();

export function getOverviewCache(key: string): any | null {
  const entry = overviewCache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    overviewCache.delete(key);
    return null;
  }
  overviewCache.delete(key);
  overviewCache.set(key, entry);
  return entry.value;
}

export function setOverviewCache(key: string, value: any) {
  if (overviewCache.size >= OVERVIEW_CACHE_MAX) {
    const firstKey = overviewCache.keys().next().value;
    if (firstKey) overviewCache.delete(firstKey);
  }
  overviewCache.set(key, { value, expires: Date.now() + OVERVIEW_CACHE_TTL_MS });
}

export function clearOverviewCache() {
  overviewCache.clear();
}
