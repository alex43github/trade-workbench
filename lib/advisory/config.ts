import type { ExpertId } from "./types.ts";

export const CORE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"] as const;

export const EXPERTS: ReadonlyArray<{
  id: ExpertId;
  name: string;
  shortName: string;
  role: string;
  skillVersion: string;
  accent: string;
}> = [
  { id: "ict", name: "ICT", shortName: "ICT", role: "流动性与高低周期叙事", skillVersion: "ict-v1", accent: "#7c6cff" },
  { id: "street", name: "街哥", shortName: "街", role: "裸K结构与真假突破", skillVersion: "street-v1", accent: "#24c98a" },
  { id: "jingxin", name: "静心", shortName: "静", role: "位置学与右侧确认", skillVersion: "jingxin-v1", accent: "#f0ad4e" },
  { id: "bitlanglang", name: "bit浪浪", shortName: "浪", role: "市场四季与强势币", skillVersion: "bitlanglang-v1", accent: "#e86785" },
] as const;

export const MAX_TRACKED_SYMBOLS = 8;
export const FORMAL_INITIAL_BALANCE = 500;
export const MAX_LEVERAGE = 10;
