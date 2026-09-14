import type { RadarBarkGroup } from "./bark-notifications.ts";
import type { Ma30LifecycleEvent } from "./ma30-lifecycle.ts";
import type { Ma30NotificationState } from "./ma30-notifications.ts";
import { isMa30BarkQuietHourBjt } from "./ma30-notifications.ts";

function displaySymbol(symbol: string): string {
  return symbol.replace(/USDT$/, "");
}

function bySymbol<T extends { symbol: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.symbol, row]));
}

function important(event: Ma30LifecycleEvent): boolean {
  return event.type === "ENTER"
    || event.type === "REENTER"
    || event.type === "STAGE_CHANGE"
    || event.type === "AI_CHANGE";
}

function eventLabel(event: Ma30LifecycleEvent): string {
  if (event.type === "REENTER") return "重新入榜";
  if (event.type === "ENTER") return "新入榜";
  if (event.type === "STAGE_CHANGE") return "阶段变化";
  if (event.type === "AI_CHANGE") return "AI变化";
  return event.type;
}

function titleEventLabel(events: readonly Ma30LifecycleEvent[]): string {
  const labels = [...new Set(events.map(eventLabel))];
  return labels.length === 1 ? labels[0]! : "重要变化";
}

/**
 * Build daytime user-visible Bark groups from durable lifecycle events rather
 * than a one-run diff. This is what makes dropout -> re-entry NEW again and
 * lets phase/AI changes remain visible without treating them as new symbols.
 */
export function buildMa30LifecycleBarkGroups(options: {
  current: Ma30NotificationState;
  events: readonly Ma30LifecycleEvent[];
  scanBucket: string;
  bjtHour: number;
}): RadarBarkGroup[] {
  if (isMa30BarkQuietHourBjt(options.bjtHour)) return [];

  const events = options.events.filter(important);
  const a = bySymbol(options.current.a);
  const b = bySymbol(options.current.b);
  const c = bySymbol(options.current.c);
  const shorts = bySymbol(options.current.shorts);
  const ai = bySymbol(options.current.ai);
  const groups: RadarBarkGroup[] = [];

  for (const group of ["A", "B", "C", "SHORT", "AI"] as const) {
    const selected = events.filter((event) => event.group === group);
    if (!selected.length) continue;
    const titleLabel = titleEventLabel(selected);

    if (group === "A") {
      const rows = selected.map((event) => ({ event, row: a.get(event.symbol) })).filter((x) => x.row);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:A:lifecycle`,
        title: `MA30斜率 A组 · ${titleLabel} ${rows.length}`,
        body: rows.map(({ event, row }) => `${displaySymbol(event.symbol)} ${eventLabel(event)} #${row!.rank} S20 ${row!.slope20.toFixed(4)}%/h`).join("｜"),
      });
      continue;
    }

    if (group === "B") {
      const rows = selected.map((event) => ({ event, row: b.get(event.symbol) })).filter((x) => x.row);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:B:lifecycle`,
        title: `MA30可用窗口新高 B组 · ${titleLabel} ${rows.length}`,
        body: rows.map(({ event, row }) => `${displaySymbol(event.symbol)} ${eventLabel(event)} #${row!.rank} 可用窗口新高${row!.ma30NewHighBars}根1H`).join("｜"),
      });
      continue;
    }

    if (group === "C") {
      const rows = selected.map((event) => ({ event, row: c.get(event.symbol) })).filter((x) => x.row);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:C:lifecycle`,
        title: `MA30加速 C组 · ${titleLabel} ${rows.length}`,
        body: rows.map(({ event, row }) => {
          const transition = event.type === "STAGE_CHANGE"
            ? ` ${event.previousStage ?? "-"}→${event.currentStage ?? row!.stage}`
            : ` ${eventLabel(event)}`;
          return `${displaySymbol(event.symbol)}${transition} #${row!.rank} 加速${row!.slope6Acceleration.toFixed(4)} 距MA ${row!.priceVsMa30Pct.toFixed(1)}%`;
        }).join("｜"),
      });
      continue;
    }

    if (group === "SHORT") {
      const rows = selected.map((event) => ({ event, row: shorts.get(event.symbol) })).filter((x) => x.row);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:SHORT:lifecycle`,
        title: `MA30空头早期加速 · ${titleLabel} ${rows.length}`,
        body: rows.map(({ event, row }) => {
          const transition = event.type === "STAGE_CHANGE"
            ? `${event.previousStage ?? "-"}→${event.currentStage ?? row!.stage}`
            : eventLabel(event);
          return `${displaySymbol(event.symbol)} ${transition} S20 ${row!.slope20.toFixed(4)} 加速${row!.slope6Acceleration.toFixed(4)} 距MA ${row!.priceVsMa30Pct.toFixed(1)}%`;
        }).join("｜"),
      });
      continue;
    }

    const rows = selected.map((event) => ({ event, row: ai.get(event.symbol) })).filter((x) => x.row);
    if (rows.length) groups.push({
      key: `radar:ma30-slope:${options.scanBucket}:AI:lifecycle`,
      title: `MA30 AI精选 · ${titleLabel} ${rows.length}`,
      body: rows.map(({ event, row }) => `${displaySymbol(event.symbol)} AI ${eventLabel(event)} #${row!.aiRank} ${row!.direction} ${row!.confidence}｜${row!.reason}`).join("\n"),
    });
  }

  return groups;
}

/**
 * Special 07:00 BJT digest. It intentionally bypasses ordinary 02:00-08:00
 * quiet-hour suppression; all other ordinary Bark remains quiet until 08:00.
 */
export function buildMa30OvernightBriefGroup(options: {
  current: Ma30NotificationState;
  scanBucket: string;
  bjtHour: number;
}): RadarBarkGroup | null {
  if (options.bjtHour !== 7) return null;

  const a = options.current.a.slice(0, 10).map((row) => `${displaySymbol(row.symbol)}#${row.rank}`).join("、") || "无";
  const b = options.current.b.slice(0, 10).map((row) => `${displaySymbol(row.symbol)}(${row.ma30NewHighBars}h)`).join("、") || "无";
  const c = options.current.c.slice(0, 8).map((row) => `${displaySymbol(row.symbol)}:${row.stage}`).join("、") || "无";
  const shorts = options.current.shorts.slice(0, 5).map((row) => displaySymbol(row.symbol)).join("、") || "无";
  const ai = [...options.current.ai].sort((left, right) => left.aiRank - right.aiRank)
    .map((row) => `${row.aiRank}.${displaySymbol(row.symbol)} ${row.direction} ${row.confidence}`).join("、") || "无";

  return {
    key: `radar:ma30-slope:${options.scanBucket}:OVERNIGHT`,
    title: "MA30扫描器 · 07:00夜间汇总",
    body: `A组：${a}\nB组(可用窗口新高)：${b}\nC组：${c}\n空头优选：${shorts}\nAI精选：${ai}`,
  };
}
