export type RadarSummaryCoin = { displayName: string; mentionCount: number; heatChange: number; shortCallRatio: number; relativeBtc4h?: number; shortCrowding?: { score: number; level: string } };

export async function getSquareIntelligenceSummary(): Promise<{ mode: string; hot: RadarSummaryCoin | null; crowding: RadarSummaryCoin | null }> {
  try {
    const { GET } = await import("../../app/api/radar/route.ts");
    const payload = await (await GET()).json() as { mode?: string; hotCoins?: RadarSummaryCoin[]; shortCrowding?: RadarSummaryCoin[] };
    return { mode: payload.mode ?? "demo", hot: payload.hotCoins?.[0] ?? null, crowding: payload.shortCrowding?.[0] ?? null };
  } catch { return { mode: "unavailable", hot: null, crowding: null }; }
}
