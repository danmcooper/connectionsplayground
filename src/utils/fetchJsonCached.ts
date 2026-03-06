type CacheEntry = {
  timestamp: number;
  data: unknown;
};

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

// Shared module-level cache across ALL tabs/components.
const cache = new Map<string, CacheEntry>();

// Optional: dedupe concurrent requests for same URL.
const inFlight = new Map<string, Promise<unknown>>();

/**
 * fetchJsonCached
 * Fetch JSON and cache the parsed result in-memory for maxAgeMs (default: 60 minutes).
 * If cached value is fresh, returns it immediately.
 * If a request is already in-flight for the same URL, returns the same Promise.
 */
export async function fetchJsonCached<T>(
  url: string,
  opts?: { maxAgeMs?: number }
): Promise<T> {
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = Date.now();

  const cached = cache.get(url);
  if (cached && now - cached.timestamp < maxAgeMs) {
    return cached.data as T;
  }

  const existing = inFlight.get(url);
  if (existing) {
    return existing as Promise<T>;
  }

  const p = (async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const data = (await res.json()) as T;
    cache.set(url, { timestamp: Date.now(), data });
    return data;
  })();

  inFlight.set(url, p as Promise<unknown>);

  try {
    return await (p as Promise<T>);
  } finally {
    inFlight.delete(url);
  }
}

/** Clear the shared cache (useful for debugging / dev tools) */
export function clearFetchJsonCache() {
  cache.clear();
  inFlight.clear();
}
