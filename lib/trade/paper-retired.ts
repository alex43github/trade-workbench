export function paperSimulationRetired() {
  return Response.json(
    { error: "PAPER simulation retired", realOrderRouteEnabled: false },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
