"use client";

import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

export type EquityPoint = { time: number; value: number };

function normalizePoints(points: EquityPoint[]) {
  const byTime = new Map<number, EquityPoint>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
    byTime.set(point.time, point);
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

export default function EquityChart({ points, theme }: { points: EquityPoint[]; theme: "dark" | "light" }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<{ chart: IChartApi; series: ISeriesApi<"Area"> } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8f93a6", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(128,103,242,.08)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.18 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "rgba(128,103,242,.35)" }, horzLine: { visible: false } },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#8067f2", topColor: "rgba(128,103,242,.35)", bottomColor: "rgba(128,103,242,.02)",
      lineWidth: 2, priceLineVisible: false,
    });
    chartRef.current = { chart, series };
    return () => { chartRef.current = null; chart.remove(); };
  }, []);

  useEffect(() => {
    const refs = chartRef.current;
    if (!refs) return;
    refs.chart.applyOptions({ layout: { textColor: theme === "dark" ? "#8f93a6" : "#7b7892" } });
    const normalizedPoints = normalizePoints(points);
    refs.series.setData(normalizedPoints.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    if (normalizedPoints.length) refs.chart.timeScale().fitContent();
  }, [points, theme]);

  return <div className="equity-chart-canvas" ref={containerRef} aria-label="币安账户资金曲线" />;
}
