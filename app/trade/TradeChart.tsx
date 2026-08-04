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
import { useEffect, useMemo, useRef } from "react";
import { calculateAnchoredVwap, calculateEma, calculateMa, calculateVolumeProfile } from "./strategyMath";

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
  ma: { enabled: boolean; length: number; color: string };
  ema: { enabled: boolean; length: number; color: string };
  avwap: { enabled: boolean; anchorBars: number; source: "hlc3" | "close"; color: string };
  volumeProfile: { enabled: boolean; rangeBars: number; rows: number };
};

export type ChartOverlay = {
  id: string;
  price: number;
  label: string;
  kind: "position" | "limit" | "conditional" | "tpsl";
  side?: "BUY" | "SELL" | "LONG" | "SHORT";
};

type Props = {
  bars: MarketBar[];
  bandPct: number;
  symbol: string;
  theme: "dark" | "light";
  indicators: IndicatorSettings;
  overlays: ChartOverlay[];
};

type ChartRefs = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  ma: ISeriesApi<"Line">;
  ema: ISeriesApi<"Line">;
  avwap: ISeriesApi<"Line">;
  upper: ISeriesApi<"Line">;
  lower: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
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

export default function TradeChart({ bars, bandPct, symbol, theme, indicators, overlays }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartRefs | null>(null);
  const maData = useMemo(() => calculateMa(bars, indicators.ma.length), [bars, indicators.ma.length]);
  const emaData = useMemo(() => calculateEma(bars, indicators.ema.length), [bars, indicators.ema.length]);
  const avwapData = useMemo(
    () => calculateAnchoredVwap(bars, indicators.avwap.anchorBars, indicators.avwap.source),
    [bars, indicators.avwap.anchorBars, indicators.avwap.source],
  );
  const volumeProfile = useMemo(
    () => calculateVolumeProfile(bars, indicators.volumeProfile.rangeBars, indicators.volumeProfile.rows),
    [bars, indicators.volumeProfile.rangeBars, indicators.volumeProfile.rows],
  );

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
      crosshair: { mode: CrosshairMode.Normal },
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
    const ma = chart.addSeries(LineSeries, { color: "#f3c955", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const ema = chart.addSeries(LineSeries, { color: "#45a9ff", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const avwap = chart.addSeries(LineSeries, { color: "#b57cff", lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true }, 0);
    const upper = chart.addSeries(LineSeries, { color: "rgba(243,201,85,.30)", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const lower = chart.addSeries(LineSeries, { color: "rgba(243,201,85,.30)", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    const markers = createSeriesMarkers(candles, []);
    chart.panes()[1]?.setHeight(92);
    chartRef.current = { chart, candles, ma, ema, avwap, upper, lower, volume, markers, priceLines: [] };
    return () => {
      chartRef.current = null;
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
    if (!refs || !bars.length) return;
    const palette = palettes[theme];
    const candleData: CandlestickData<UTCTimestamp>[] = bars.map((bar) => ({
      time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    }));
    const asLineData = (points: Array<{ time: number; value: number }>): LineData<UTCTimestamp>[] =>
      points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }));
    refs.candles.setData(candleData);
    refs.ma.setData(asLineData(maData));
    refs.ema.setData(asLineData(emaData));
    refs.avwap.setData(asLineData(avwapData));
    refs.upper.setData(asLineData(maData.map((point) => ({ ...point, value: point.value * (1 + bandPct / 100) }))));
    refs.lower.setData(asLineData(maData.map((point) => ({ ...point, value: point.value * (1 - bandPct / 100) }))));
    refs.volume.setData(bars.map((bar) => ({
      time: bar.time as UTCTimestamp, value: bar.volume,
      color: bar.close >= bar.open ? palette.volumeUp : palette.volumeDown,
    })) as HistogramData<UTCTimestamp>[]);
    refs.ma.applyOptions({ visible: indicators.ma.enabled, color: indicators.ma.color });
    refs.upper.applyOptions({ visible: indicators.ma.enabled });
    refs.lower.applyOptions({ visible: indicators.ma.enabled });
    refs.ema.applyOptions({ visible: indicators.ema.enabled, color: indicators.ema.color });
    refs.avwap.applyOptions({ visible: indicators.avwap.enabled, color: indicators.avwap.color });

    const maByTime = new Map(maData.map((point) => [point.time, point.value]));
    refs.markers.setMarkers(indicators.ma.enabled ? bars.filter((bar) => {
      const value = maByTime.get(bar.time);
      return value !== undefined && bar.low <= value * (1 + bandPct / 100) && bar.high >= value * (1 - bandPct / 100);
    }).slice(-5).map((bar) => ({
      time: bar.time as UTCTimestamp, position: "belowBar" as const, color: indicators.ma.color,
      shape: "circle" as const, text: "MA触及",
    })) : []);

    refs.priceLines.forEach((line) => refs.candles.removePriceLine(line));
    refs.priceLines = overlays.filter((overlay) => Number.isFinite(overlay.price) && overlay.price > 0).map((overlay) => {
      const color = overlay.kind === "position" ? "#45a9ff" : overlay.kind === "limit" ? "#f0a84a" : overlay.kind === "tpsl" ? "#ef646b" : "#b57cff";
      return refs.candles.createPriceLine({
        price: overlay.price, color, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: overlay.label,
      });
    });
    refs.chart.timeScale().fitContent();
  }, [bars, maData, emaData, avwapData, bandPct, indicators, overlays, symbol, theme]);

  return (
    <div className="trade-chart-stage">
      <div className="trade-chart-canvas" ref={containerRef} aria-label={`${symbol} K线与可配置指标图`} />
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
