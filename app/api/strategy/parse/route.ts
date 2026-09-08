import { requireOperatorMutation } from "@/lib/security/operator-guard";

type ParsedStrategy = {
  name: string;
  timeframes: string[];
  maLength: number;
  entryBandPct: number;
  entryTrigger: "touch_or_close_in_band";
  sizeMode: "fixed_usdt" | "available_pct";
  sizeValue: number;
  maxEntries: number;
  firstExitPct: number;
  secondExitPct: number;
  consecutiveCloses: number;
};

const defaults: ParsedStrategy = {
  name: "MA30多周期回撤策略",
  timeframes: ["15m", "1h", "4h", "1d"],
  maLength: 30,
  entryBandPct: 1,
  entryTrigger: "touch_or_close_in_band",
  sizeMode: "fixed_usdt",
  sizeValue: 100,
  maxEntries: 3,
  firstExitPct: 50,
  secondExitPct: 50,
  consecutiveCloses: 2,
};

function matchNumber(text: string, patterns: RegExp[], fallback: number) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return fallback;
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "strategy_text_required" }, { status: 400 });

  const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d"].filter((timeframe) =>
    new RegExp(`(^|[^a-z0-9])${timeframe}([^a-z0-9]|$)`, "i").test(text),
  );
  const hasAvailablePct = /可用资金|余额|available/i.test(text) && /%|％/.test(text);
  const fixedUsdt = matchNumber(text, [/(\d+(?:\.\d+)?)\s*(?:u|usdt|美元)/i, /固定(?:金额)?\s*(\d+(?:\.\d+)?)/i], defaults.sizeValue);
  const availablePct = matchNumber(text, [/(\d+(?:\.\d+)?)\s*[%％]\s*(?:可用资金|余额)/i, /(?:可用资金|余额)[^\d]{0,8}(\d+(?:\.\d+)?)\s*[%％]/i], 5);
  const strategy: ParsedStrategy = {
    ...defaults,
    timeframes: timeframes.length ? timeframes : defaults.timeframes,
    maLength: Math.round(matchNumber(text, [/(\d+)\s*ma/i, /ma\s*(\d+)/i], defaults.maLength)),
    entryBandPct: matchNumber(text, [/[+±＋-]\s*(\d+(?:\.\d+)?)\s*[%％]/i, /上下[^\d]{0,5}(\d+(?:\.\d+)?)\s*[%％]/i], defaults.entryBandPct),
    sizeMode: hasAvailablePct ? "available_pct" : "fixed_usdt",
    sizeValue: hasAvailablePct ? availablePct : fixedUsdt,
    maxEntries: Math.round(matchNumber(text, [/(?:买入|加仓|动作|次数)[^\d]{0,8}(\d+)\s*次/i, /满\s*(\d+)\s*次/i], defaults.maxEntries)),
    firstExitPct: matchNumber(text, [/(?:第一根|首次|第一次)[^。；,，]{0,18}(\d+(?:\.\d+)?)\s*[%％]/i, /跌破[^。；,，]{0,12}卖出\s*(\d+(?:\.\d+)?)\s*[%％]/i], defaults.firstExitPct),
    secondExitPct: matchNumber(text, [/(?:第二根|第二次|继续)[^。；,，]{0,18}(\d+(?:\.\d+)?)\s*[%％]/i], defaults.secondExitPct),
    consecutiveCloses: 2,
  };
  const warnings: string[] = [];
  if (strategy.maLength < 2 || strategy.maLength > 500) warnings.push("MA周期超出2—500的安全范围");
  if (strategy.entryBandPct <= 0 || strategy.entryBandPct > 10) warnings.push("入场带宽应在0—10%之间");
  if (strategy.maxEntries < 1 || strategy.maxEntries > 10) warnings.push("最大买入次数应在1—10次之间");
  if (strategy.sizeValue <= 0) warnings.push("每次买入金额必须大于0");

  return Response.json({
    parser: "deterministic-v1",
    strategy,
    warnings,
    normalizedRules: [
      `${strategy.timeframes.join(" / ")} 使用MA${strategy.maLength}`,
      `盘中触及MA或收盘进入上下±${strategy.entryBandPct}%区域时允许买入`,
      `每次使用${strategy.sizeMode === "fixed_usdt" ? `${strategy.sizeValue} USDT保证金，名义价值按默认杠杆计算` : `可用资金的${strategy.sizeValue}%作为保证金，名义价值按默认杠杆计算`}`,
      `同一轮最多买入${strategy.maxEntries}次，直到发生卖出后才重置`,
      `入场周期首根收盘跌破MA卖出当前持仓${strategy.firstExitPct}%，下一根仍跌破再卖出剩余持仓${strategy.secondExitPct}%`,
    ],
  });
}
