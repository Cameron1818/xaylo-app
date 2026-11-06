import { httpError } from '../security/access.js';

/** Never include upstream payloads, credentials or request URLs in thrown errors. */
export async function sourceJson<T>(source: string, url: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
    catch { throw httpError(502, `${source} is unavailable; try again`); }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retry = Math.min(2000, Math.max(100, Number(response.headers.get('retry-after') ?? 0) * 1000 || 200 * (attempt + 1)));
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, retry));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(502, response.status === 401 || response.status === 403
        ? `${source} access denied; reconnect and check the required permissions`
        : `${source} request failed (${response.status})`);
    }
    try { return await response.json() as T; }
    catch { throw httpError(502, `${source} returned an invalid response`); }
  }
  throw httpError(502, `${source} is unavailable`);
}
