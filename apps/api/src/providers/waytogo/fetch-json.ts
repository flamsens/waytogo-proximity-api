/**
 * GETs a URL and parses it as JSON. Aborts after `timeoutMs` or when `signal` fires
 * (e.g. on shutdown). Node's fetch negotiates gzip, keeping the multi-MB feeds small.
 * @throws on network errors, timeouts, non-2xx status and invalid JSON.
 */
export async function fetchJson(url: string, timeoutMs: number, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  return response.json();
}
