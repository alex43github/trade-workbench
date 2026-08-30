"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildFillMarkers, buildLifecycleChartSeries, buildTradeLifecycleLines, calculateAnchoredVwap, calculateAtr, calculateAtrBand, calculateEma, calculateMa, calculateVolumeProfile, type TradeFill } from "./strategyMath";
import { createPriceFormat, formatPrice, inferPriceStep } from "./priceFormat";

export type MarketBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

export type IndicatorSettings = {
  ma: { enabled: boolean; length: number; color: string; lineWidth: 1 | 2 | 3 | 4 };
  ema: { enabled: boolean; length: number; color: string; lineWidth: 1 | 2 | 3 | 4 };
  atr: { upperColor: string; lowerColor: string; upperLineWidth: 1 | 2 | 3 | 4; lowerLineWidth: 1 | 2 | 3 | 4 };
  avwap: { enabled: boolean; anchorBars: number; source: "hlc3" | "close"; color: string; lineWidth: 1 | 2 | 3 | 4 };
  volumeProfile: { enabled: boolean; rangeBars: number; rows: number };
  vegas: {
    enabled: boolean;
    fastLength: number;
    slowLength: number;
    outerFastLength: number;
    outerSlowLength: number;
    firstColor: string;
    secondColor: string;
    lineWidth: 1 | 2 | 3 | 4;
  };
};

export type ChartOverlay = {
  id: string;
  price: number;
  label: string;
  kind: "position" | "cost" | "limit" | "conditional" | "tpsl" | "manual";
  side?: "BUY" | "SELL" | "LONG" | "SHORT";
};

type Props = {
  bars: MarketBar[];
  fills: TradeFill[];
  symbol: string;
  theme: "dark" | "light";
  indicators: IndicatorSettings;
  overlays: ChartOverlay[];
  priceTickSize?: number | null;
  indicatorBasis: "ma" | "ema";
  atrLength: number;
  atrUpperMultiplier: number;
  atrLowerMultiplier: number;
  trendAtrEnabled?: boolean;
  trendAtrMultiplier?: number;
  drawingLine?: boolean;
  onManualLineChange?: (price: number) => void;
};

type ChartRefs = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  ma: ISeriesApi<"Line">;
  ema: ISeriesApi<"Line">;
  vegas144: ISeriesApi<"Line">;
  vegas169: ISeriesApi<"Line">;
  vegas576: ISeriesApi<"Line">;
  vegas676: ISeriesApi<"Line">;
  avwap: ISeriesApi<"Line">;
  upper: ISeriesApi<"Line">;
  lower: ISeriesApi<"Line">;
  trendUpper: ISeriesApi<"Line">;
  trendLower: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
  lifecycleLines: ISeriesApi<"Line">[];
  priceLines: IPriceLine[];
};

const palettes = {
  dark: {
    background: "#10111a", text: "#8f93a6", grid: "#1e2030", border: "#2a2d40",
    up: "#2cc985", down: "#ef646b", volumeUp: "rgba(44,201,133,.34)", volumeDown: "rgba(239,100,107,.34)",
  },
  light: {
    background: "#ffffff", text: "#7b7892", grid: "#efedf7", border: "#dedbea",
    up: "#16ad69", down: "#e3515b", volumeUp: "rgba(22,173,105,.28)", volumeDown: "rgba(227,81,91,.25)",
  },
};

export default function TradeChart({ bars, fills, symbol, theme, indicators, overlays, priceTickSize, indicatorBasis, atrLength, atrUpperMultiplier, atrLowerMultiplier, trendAtrEnabled = true, trendAtrMultiplier = 3, drawingLine = false, onManualLineChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartRefs | null>(null);
  const latestCloseRef = useRef(0);
  const drawingLineRef = useRef(drawingLine);
  const onManualLineChangeRef = useRef(onManualLineChange);
  const [hoverPrice, setHoverPrice] = useState<{ price: number; changePct: number; y: number } | null>(null);
  const maData = useMemo(() => calculateMa(bars, indicators.ma.length), [bars, indicators.ma.length]);
  const emaData = useMemo(() => calculateEma(bars, indicators.ema.length), [bars, indicators.ema.length]);
  const vegas144Data = useMemo(() => calculateEma(bars, indicators.vegas.fastLength), [bars, indicators.vegas.fastLength]);
  const vegas169Data = useMemo(() => calculateEma(bars, indicators.vegas.slowLength), [bars, indicators.vegas.slowLength]);
  const vegas576Data = useMemo(() => calculateEma(bars, indicators.vegas.outerFastLength), [bars, indicators.vegas.outerFastLength]);
  const vegas676Data = useMemo(() => calculateEma(bars, indicators.vegas.outerSlowLength), [bars, indicators.vegas.outerSlowLength]);
  const atrData = useMemo(() => calculateAtr(bars, atrLength), [bars, atrLength]);
  const avwapData = useMemo(
    () => calculateAnchoredVwap(bars, indicators.avwap.anchorBars, indicators.avwap.source),
    [bars, indicators.avwap.anchorBars, indicators.avwap.source],
  );
  const volumeProfile = useMemo(
    () => calculateVolumeProfile(bars, indicators.volumeProfile.rangeBars, indicators.volumeProfile.rows),
    [bars, indicators.volumeProfile.rangeBars, indicators.volumeProfile.rows],
  );
  const inferredPriceStep = useMemo(
    () => inferPriceStep(
      [...bars.flatMap((bar) => [bar.open, bar.high, bar.low, bar.close]), ...overlays.map((overlay) => overlay.price)],
      priceTickSize ?? undefined,
    ),
    [bars, overlays, priceTickSize],
  );
  const lifecycleLines = useMemo(() => buildTradeLifecycleLines(bars, fills), [bars, fills]);
  const lifecycleChartSeries = useMemo(() => buildLifecycleChartSeries(lifecycleLines), [lifecycleLines]);

  useEffect(() => {
    latestCloseRef.current = bars.at(-1)?.close ?? 0;
  }, [bars]);

  useEffect(() => {
    drawingLineRef.current = drawingLine;
    onManualLineChangeRef.current = onManualLineChange;
  }, [drawingLine, onManualLineChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    const palette = palettes.dark;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace", attributionLogo: true,
        panes: { separatorColor: palette.border, separatorHoverColor: "#8067f2", enableResize: true },
      },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(22, 21, 30, .82)", width: 1, style: LineStyle.Dashed, labelVisible: false },
        horzLine: { color: "rgba(22, 21, 30, .82)", width: 1, style: LineStyle.Dashed, labelVisible: false },
      },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 10 },
      localization: {
        timeFormatter: (time: Time) => typeof time === "number"
          ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(time * 1000))
          : String(time),
      },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: palette.up, downColor: palette.down, wickUpColor: palette.up, wickDownColor: palette.down,
      borderVisible: false, priceLineColor: "#8067f2",
    }, 0);
    const ma = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 3, lineStyle: LineStyle.Solid, priceLineVisible: false, lastValueVisible: true }, 0);
    const ema = chart.addSeries(LineSeries, { color: "#45a9ff", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const vegas144 = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const vegas169 = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const vegas576 = chart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const vegas676 = chart.addSeries(LineSeries, { color: "#ec4899", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const avwap = chart.addSeries(LineSeries, { color: "#b57cff", lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true }, 0);
    const upper = chart.addSeries(LineSeries, { color: "#111827", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const lower = chart.addSeries(LineSeries, { color: "#111827", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const trendUpper = chart.addSeries(LineSeries, { color: "#f0a84a", lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const trendLower = chart.addSeries(LineSeries, { color: "#f0a84a", lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    const markers = createSeriesMarkers(candles, []);
    chart.panes()[1]?.setHeight(92);
    chartRef.current = { chart, candles, ma, ema, vegas144, vegas169, vegas576, vegas676, avwap, upper, lower, trendUpper, trendLower, volume, markers, lifecycleLines: [], priceLines: [] };
    const onCrosshairMove = (param: { point?: { y: number } }) => {
      if (!param.point || latestCloseRef.current <= 0) {
        setHoverPrice(null);
        return;
      }
      const price = candles.coordinateToPrice(param.point.y);
      if (price === null || !Number.isFinite(price)) {
        setHoverPrice(null);
        return;
      }
      setHoverPrice({ price, changePct: ((price - latestCloseRef.current) / latestCloseRef.current) * 100, y: param.point.y });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    const onClick = (param: { point?: { y: number } }) => {
      if (!drawingLineRef.current || !param.point) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price === null || !Number.isFinite(price) || price <= 0) return;
      onManualLineChangeRef.current?.(price);
    };
    chart.subscribeClick(onClick);
    return () => {
      chartRef.current = null;
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const refs = chartRef.current;
    if (!refs) return;
    const palette = palettes[theme];
    refs.chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border }, timeScale: { borderColor: palette.border },
    });
    refs.candles.applyOptions({ upColor: palette.up, downColor: palette.down, wickUpColor: palette.up, wickDownColor: palette.down });
  }, [theme]);

  useEffect(() => {
    const refs = chartRef.current;
    if (!refs) return;
    const priceFormat = createPriceFormat(inferredPriceStep);
    refs.candles.applyOptions({ priceFormat });
    refs.ma.applyOptions({ priceFormat });
    refs.ema.applyOptions({ priceFormat });
    refs.vegas144.applyOptions({ priceFormat });
    refs.vegas169.applyOptions({ priceFormat });
    refs.vegas576.applyOptions({ priceFormat });
    refs.vegas676.applyOptions({ priceFormat });
    refs.avwap.applyOptions({ priceFormat });
    refs.upper.applyOptions({ priceFormat });
    refs.lower.applyOptions({ priceFormat });
    refs.trendUpper.applyOptions({ priceFormat }); refs.trendLower.applyOptions({ priceFormat });
    if (!bars.length) {
      refs.candles.setData([]);
      refs.markers.setMarkers([]);
      refs.lifecycleLines.forEach((line) => refs.chart.removeSeries(line));
      refs.lifecycleLines = [];
      refs.priceLines.forEach((line) => refs.candles.removePriceLine(line));
      refs.priceLines = [];
      return;
    }
    const visibleLogicalRange = refs.chart.timeScale().getVisibleLogicalRange();
    const palette = palettes[theme];
    const candleData: CandlestickData<UTCTimestamp>[] = bars.map((bar) => ({
      time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    }));
    const asLineData = (points: Array<{ time: number; value: number }>): LineData<UTCTimestamp>[] =>
      points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }));
    refs.candles.setData(candleData);
   refs.ma.setData(asLineData(maData));
   refs.ema.setData(asLineData(emaData));
    refs.vegas144.setData(asLineData(vegas144Data));
    refs.vegas169.setData(asLineData(vegas169Data));
    refs.vegas576.setData(asLineData(vegas576Data));
    refs.vegas676.setData(asLineData(vegas676Data));
    refs.avwap.setData(asLineData(avwapData));
    const basisData = indicatorBasis === "ema" ? emaData : maData;
    const atrByTime = new Map(atrData.map((point) => [point.time, point.value]));
    const upperBand = basisData.flatMap((point) => {
      const atr = atrByTime.get(point.time);
      const band = atr === undefined ? null : calculateAtrBand(point.value, atr, atrUpperMultiplier, atrLowerMultiplier);
      return band ? [{ time: point.time, value: band.upper }] : [];
    });
    const lowerBand = basisData.flatMap((point) => {
      const atr = atrByTime.get(point.time);
      const band = atr === undefined ? null : calculateAtrBand(point.value, atr, atrUpperMultiplier, atrLowerMultiplier);
      return band ? [{ time: point.time, value: band.lower }] : [];
    });
    refs.upper.setData(asLineData(upperBand));
    refs.lower.setData(asLineData(lowerBand));
    const trendUpper = basisData.flatMap((point, index) => { const atr = atrByTime.get(point.time); const previous = basisData[index - 1]; return atr === undefined || !previous || point.value <= previous.value ? [] : [{ time: point.time, value: point.value + atr * trendAtrMultiplier }]; });
    const trendLower = basisData.flatMap((point, index) => { const atr = atrByTime.get(point.time); const previous = basisData[index - 1]; return atr === undefined || !previous || point.value >= previous.value ? [] : [{ time: point.time, value: point.value - atr * trendAtrMultiplier }]; });
    refs.trendUpper.setData(asLineData(trendUpper)); refs.trendLower.setData(asLineData(trendLower));
    refs.volume.setData(bars.map((bar) => ({
      time: bar.time as UTCTimestamp, value: bar.volume,
      color: bar.close >= bar.open ? palette.volumeUp : palette.volumeDown,
    })) as HistogramData<UTCTimestamp>[]);
    refs.ma.applyOptions({ visible: indicators.ma.enabled, color: indicators.ma.color, lineWidth: indicators.ma.lineWidth, lineStyle: LineStyle.Solid });
    refs.upper.applyOptions({ visible: indicators.ma.enabled, color: indicators.atr.upperColor, lineWidth: indicators.atr.upperLineWidth, lineStyle: LineStyle.Dashed });
    refs.lower.applyOptions({ visible: indicators.ma.enabled, color: indicators.atr.lowerColor, lineWidth: indicators.atr.lowerLineWidth, lineStyle: LineStyle.Dashed });
    refs.trendUpper.applyOptions({ visible: indicators.ma.enabled && trendAtrEnabled, lineStyle: LineStyle.Dashed }); refs.trendLower.applyOptions({ visible: indicators.ma.enabled && trendAtrEnabled, lineStyle: LineStyle.Dashed });
   refs.ema.applyOptions({ visible: indicators.ema.enabled, color: indicators.ema.color, lineWidth: indicators.ema.lineWidth });
    refs.vegas144.applyOptions({ visible: indicators.vegas.enabled, color: indicators.vegas.firstColor, lineWidth: indicators.vegas.lineWidth });
    refs.vegas169.applyOptions({ visible: indicators.vegas.enabled, color: indicators.vegas.firstColor, lineWidth: indicators.vegas.lineWidth });
    refs.vegas576.applyOptions({ visible: indicators.vegas.enabled, color: indicators.vegas.secondColor, lineWidth: indicators.vegas.lineWidth });
    refs.vegas676.applyOptions({ visible: indicators.vegas.enabled, color: indicators.vegas.secondColor, lineWidth: indicators.vegas.lineWidth });
    refs.avwap.applyOptions({ visible: indicators.avwap.enabled, color: indicators.avwap.color, lineWidth: indicators.avwap.lineWidth });

    refs.markers.setMarkers(buildFillMarkers(bars, fills).map((marker) => ({ ...marker, time: marker.time as UTCTimestamp })));
    refs.lifecycleLines.forEach((line) => refs.chart.removeSeries(line));
    refs.lifecycleLines = lifecycleChartSeries.map((lifecycle) => {
      const line = refs.chart.addSeries(LineSeries, {
        color: lifecycle.color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, priceFormat,
      }, 0);
      line.setData([
        { time: lifecycle.entry.time as UTCTimestamp, value: lifecycle.entry.value },
        { time: lifecycle.exit.time as UTCTimestamp, value: lifecycle.exit.value },
      ]);
      return line;
    });

    refs.priceLines.forEach((line) => refs.candles.removePriceLine(line));
    refs.priceLines = overlays.filter((overlay) => Number.isFinite(overlay.price) && overlay.price > 0).map((overlay) => {
      const color = overlay.kind === "position" ? "#45a9ff" : overlay.kind === "cost" ? "#111827" : overlay.kind === "limit" ? "#f0a84a" : overlay.kind === "tpsl" ? "#ef646b" : overlay.kind === "manual" ? "#ef646b" : "#b57cff";
      return refs.candles.createPriceLine({
        price: overlay.price, color, lineWidth: overlay.kind === "manual" || overlay.kind === "cost" ? 2 : 1, lineStyle: overlay.kind === "manual" ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
      });
    });
    if (visibleLogicalRange) refs.chart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
    else refs.chart.timeScale().fitContent();
  }, [bars, fills, lifecycleChartSeries, maData, emaData, vegas144Data, vegas169Data, vegas576Data, vegas676Data, atrData, avwapData, atrUpperMultiplier, atrLowerMultiplier, trendAtrEnabled, trendAtrMultiplier, indicatorBasis, indicators, overlays, symbol, theme, inferredPriceStep]);

  return (
    <div className="trade-chart-stage">
      <div className="trade-chart-canvas" ref={containerRef} aria-label={`${symbol} K线与可配置指标图`} />
      {lifecycleLines.length > 0 && <section aria-label="策略生命周期图例" style={{ position: "absolute", top: 8, left: 8, display: "grid", gap: 4, fontSize: 11 }}>
        {lifecycleLines.map((lifecycle) => <div key={lifecycle.id} style={{ color: lifecycle.outcomeColor }}>
          策略组 {lifecycle.id} · 入场 {formatPrice(lifecycle.entryPrice, inferredPriceStep)} · 出场 {formatPrice(lifecycle.exitPrice, inferredPriceStep)} · 数量 {lifecycle.entryQuantity} · 已实现盈亏 {lifecycle.realizedPnl >= 0 ? "+" : ""}{lifecycle.realizedPnl.toFixed(2)} · 收益率 {lifecycle.returnPct >= 0 ? "+" : ""}{lifecycle.returnPct.toFixed(2)}%
        </div>)}
      </section>}
      {hoverPrice && <div className="crosshair-price-label" style={{ top: `${Math.max(20, hoverPrice.y)}px` }} aria-live="polite">
        <strong>{formatPrice(hoverPrice.price, inferredPriceStep)}</strong>
        <span>{hoverPrice.changePct >= 0 ? "+" : ""}{hoverPrice.changePct.toFixed(2)}%</span>
      </div>}
      {indicators.volumeProfile.enabled && volumeProfile.length > 0 && (
        <div className="volume-profile" aria-label={`最近${indicators.volumeProfile.rangeBars}根K线固定区间成交量分布`}>
          {volumeProfile.map((bin) => (
            <span key={`${bin.low}-${bin.high}`} className={bin.ratio === 1 ? "poc" : ""} style={{ width: `${Math.max(3, bin.ratio * 100)}%` }} />
          ))}
          <small>FRVP · {indicators.volumeProfile.rangeBars} bars</small>
        </div>
      )}
    </div>
  );
}
