import type { Timeframe } from "../../lib/structure-radar/types.ts";

export const BINANCE_FUTURES_REST = "https://fapi.binance.com";
export const BINANCE_FUTURES_STREAM = "wss://fstream.binance.com/stream";
export const RADAR_TIMEFRAMES = ["15m", "1h", "4h"] as const satisfies readonly Timeframe[];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
};

export function loadRadarConfig(environment: Record<string, string | undefined> = process.env) {
  const requestedPort = Number.parseInt(environment.RADAR_PORT ?? "8790", 10);
  return {
    hostname: "127.0.0.1" as const,
    port: Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65_535 ? requestedPort : 8_790,
    dataDirectory: environment.RADAR_DATA_DIRECTORY?.trim() || ".data/structure-radar",
    localToken: environment.RADAR_LOCAL_TOKEN?.trim() || "",
    notificationsEnabled: environment.RADAR_NOTIFY_ENABLED === "true",
    timeframes: [...RADAR_TIMEFRAMES],
    skillPaths: {
      ict: environment.RADAR_ICT_SKILL_PATH || "/Users/niangao/.codex/skills/ict-trading/SKILL.md",
      street: environment.RADAR_STREET_SKILL_PATH || "/Users/niangao/.codex/skills/street-trading/SKILL.md",
      jingxin: environment.RADAR_JINGXIN_SKILL_PATH || "/Users/niangao/.codex/skills/jingxin-trading/SKILL.md",
      bitlanglang: environment.RADAR_BITLANGLANG_SKILL_PATH || "/Users/niangao/.codex/skills/bitlanglang-trading/SKILL.md",
    },
  };
}
