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
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { calculateMa } from "./strategyMath";

export type MarketBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

type Props = {
  bars: MarketBar[];
  maLength: number;
  bandPct: number;
  symbol: string;
};

type ChartRefs = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  ma: ISeriesApi<"Line">;
  upper: ISeriesApi<"Line">;
  lower: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
};

export default function TradeChart({ bars, maLength, bandPct, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartRefs | null>(null);
  const maData = useMemo(() => calculateMa(bars, maLength), [bars, maLength]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#101510" },
        textColor: "#8f998e",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        attributionLogo: true,
        panes: { separatorColor: "#283128", separatorHoverColor: "#d8ff3e", enableResize: true },
      },
      grid: { vertLines: { color: "#1b231b" }, horzLines: { color: "#1b231b" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2b342b", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: "#2b342b", timeVisible: true, secondsVisible: false, rightOffset: 8 },
      localization: {
        timeFormatter: (time: Time) => typeof time === "number"
          ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(time * 1000))
          : String(time),
      },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#77c98b", downColor: "#e0645c", wickUpColor: "#77c98b", wickDownColor: "#e0645c",
      borderVisible: false, priceLineColor: "#d8ff3e",
    }, 0);
    const ma = chart.addSeries(LineSeries, { color: "#d8ff3e", lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 0);
    const upper = chart.addSeries(LineSeries, { color: "rgba(216,255,62,.34)", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const lower = chart.addSeries(LineSeries, { color: "rgba(216,255,62,.34)", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0);
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    const markers = createSeriesMarkers(candles, []);
    chart.panes()[1]?.setHeight(105);
    chartRef.current = { chart, candles, ma, upper, lower, volume, markers };
    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const refs = chartRef.current;
    if (!refs || !bars.length) return;
    const candleData: CandlestickData<UTCTimestamp>[] = bars.map((bar) => ({
      time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    }));
    const lineData: LineData<UTCTimestamp>[] = maData.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }));
    const upperData: LineData<UTCTimestamp>[] = maData.map((point) => ({ time: point.time as UTCTimestamp, value: point.value * (1 + bandPct / 100) }));
    const lowerData: LineData<UTCTimestamp>[] = maData.map((point) => ({ time: point.time as UTCTimestamp, value: point.value * (1 - bandPct / 100) }));
    const volumeData: HistogramData<UTCTimestamp>[] = bars.map((bar) => ({
      time: bar.time as UTCTimestamp, value: bar.volume, color: bar.close >= bar.open ? "rgba(119,201,139,.36)" : "rgba(224,100,92,.36)",
    }));
    refs.candles.setData(candleData);
    refs.ma.setData(lineData);
    refs.upper.setData(upperData);
    refs.lower.setData(lowerData);
    refs.volume.setData(volumeData);
    const maByTime = new Map(maData.map((point) => [point.time, point.value]));
    const touches = bars
      .filter((bar) => {
        const value = maByTime.get(bar.time);
        return value !== undefined && bar.low <= value * (1 + bandPct / 100) && bar.high >= value * (1 - bandPct / 100);
      })
      .slice(-6)
      .map((bar) => ({ time: bar.time as UTCTimestamp, position: "belowBar" as const, color: "#d8ff3e", shape: "circle" as const, text: "MA触及" }));
    refs.markers.setMarkers(touches);
    refs.chart.timeScale().fitContent();
  }, [bars, maData, bandPct, symbol]);

  return <div className="trade-chart-canvas" ref={containerRef} aria-label={`${symbol} K线、MA与成交量图`} />;
}
