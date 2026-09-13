import { listManualFocusSymbols } from "./focus-source-store.ts";

type Queryable = Parameters<typeof listManualFocusSymbols>[0];
type Dependencies = { token: string; db: Queryable; ensure: () => Promise<void> };

function safeEqual(expected: string, actual: string) {
  let difference = expected.length ^ actual.length;
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) difference |= (expected.charCodeAt(index) || 0) ^ (actual.charCodeAt(index) || 0);
  return difference === 0;
}

export async function handleFocusSourcesGet(request: Request, dependencies: Dependencies) {
  const token = dependencies.token.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!token || !safeEqual(`Bearer ${token}`, authorization)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  try {
    await dependencies.ensure();
    return Response.json({ symbols: await listManualFocusSymbols(dependencies.db) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "focus sources unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
