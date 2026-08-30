"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useRef, useState } from "react";
import AdaptiveStrategyPanel from "./AdaptiveStrategyPanel";
import EquityChart, { type EquityPoint } from "./EquityChart";
import TradeKnowledgePanel from "./TradeKnowledgePanel";
import TradeChart, { type ChartOverlay, type IndicatorSettings, type MarketBar } from "./TradeChart";
import type { TradeFill } from "./strategyMath";
import { calculateAtr, calculateAtrBand, calculateEma, calculateMa, formatAtrDistance } from "./strategyMath";
import { useTerminalTheme, type ThemeMode } from "../themeStore";
import FontControl from "../components/FontControl";
import { useFontScale } from "../uiPreferences";
import { fetchBrowserBinanceKlines } from "../binancePublicBrowser";
import type { PositionAnalysisResponse, PositionContext } from "@/lib/trade/position-analysis";
import type { ExpertId } from "@/lib/advisory/types";
import { resolveRealTradingStatus } from "@/lib/trade/live-mode";
import { LIVE_CLOSE_PERCENT_OPTIONS, type LiveClosePercent } from "@/lib/trade/live-position-close";
import { displayBinanceSymbol, normalizeBinanceFuturesSymbol, quoteAssetForSymbol } from "@/lib/trade/symbols";
import type { HorizontalStopLine } from "@/lib/trade/horizontal-stop-line";
import styles from "./trade.module.css";

type Strategy = {
  name: string;
  timeframes: string[];
  maLength: number;
  basis: "ma" | "ema";
  entryBandPct: number;
  entryAtrUpper: number;
  entryAtrLower: number;
  trendAtrEnabled: boolean;
  trendAtrMultiplier: number;
  entryTrigger: "touch_or_close_in_band";
  sizeMode: "fixed_usdt" | "available_pct";
  sizeValue: number;
  maxEntries: number;
  firstExitPct: number;
  secondExitPct: number;
  consecutiveCloses: number;
};

type AccountPosition = {
  symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; breakEvenPrice: number;
  markPrice: number; unrealizedPnl: number; liquidationPrice: number; leverage: number; marginType: string; positionSide: string;
  occupiedMargin: number | null; notional: number | null;
};
type AccountOrder = {
  orderId: string; websiteOrderId?: string; symbol: string; side: "BUY" | "SELL"; type: string; status: string; price: number;
  stopPrice: number; quantity: number; executedQuantity: number; reduceOnly: boolean; positionSide: string; time: number; updateTime: number;
};
type AccountFill = TradeFill & { orderId: string; positionSide: string };
type AccountResponse = {
  connected: boolean; reason?: string; updatedAt: string;
  account: { totalBalance: number; availableBalance: number; unrealizedPnl: number; currency: string };
  currentLeverage: number | null;
  positions: AccountPosition[]; limitOrders: AccountOrder[]; conditionalOrders: AccountOrder[]; fills: AccountFill[];
};
type ProtectionStatusEntry = { symbol: string; side: "LONG" | "SHORT"; protectedQuantity: number };
type MarketResponse = { mode: "live"; symbol: string; interval: string; updatedAt: string; warning?: string; bars: MarketBar[]; priceTickSize?: number | null };
type EventItem = { id: string; time: string; type: "check" | "candidate" | "system"; message: string };
type AiStrongCoin = { symbol: string; displayName?: string; score: number; participation: string; price?: number; verdict?: string };
type OverlayVisibility = { positions: boolean; positionCost: boolean; limits: boolean; conditional: boolean; tpsl: boolean };

const emptyAccount: AccountResponse = {
  connected: false, reason: "尚未配置币安只读 API", updatedAt: "",
  account: { totalBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT" },
  currentLeverage: null,
  positions: [], limitOrders: [], conditionalOrders: [], fills: [],
};
const defaultStrategy: Strategy = {
  name: "MA30多周期回撤策略", timeframes: ["15m", "1h", "4h", "1d"], maLength: 30, basis: "ma",
  entryBandPct: 1, entryAtrUpper: 1, entryAtrLower: 1, trendAtrEnabled: true, trendAtrMultiplier: 3, entryTrigger: "touch_or_close_in_band", sizeMode: "fixed_usdt", sizeValue: 100,
  maxEntries: 3, firstExitPct: 50, secondExitPct: 50, consecutiveCloses: 2,
};
const defaultIndicators: IndicatorSettings = {
  ma: { enabled: true, length: 30, color: "#2563eb", lineWidth: 3 },
  ema: { enabled: false, length: 20, color: "#45a9ff", lineWidth: 2 },
  atr: { upperColor: "#111827", lowerColor: "#111827", upperLineWidth: 1, lowerLineWidth: 1 },
  avwap: { enabled: false, anchorBars: 100, source: "hlc3", color: "#b57cff", lineWidth: 2 },
  volumeProfile: { enabled: false, rangeBars: 120, rows: 28 },
  vegas: { enabled: true, fastLength: 144, slowLength: 169, outerFastLength: 576, outerSlowLength: 676, firstColor: "#f59e0b", secondColor: "#ec4899", lineWidth: 2 },
};
const LIVE_SWITCH_STORAGE_KEY = "streetlight-live-switch-v1";
const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
const quickSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"];
type SymbolOption = { symbol: string; displayName: string; quoteAsset?: "USDT" | "USDC" };
type SymbolsResponse = { symbols?: SymbolOption[]; warning?: string };
type PendingAnalysis = PositionContext & { symbol: string };
const expertOptions: Array<{ id: "all" | ExpertId; name: string; description: string }> = [
  { id: "all", name: "四位联合分析", description: "ICT、街哥、静心、bit浪浪共同复核并汇总" },
  { id: "ict", name: "ICT", description: "流动性、结构和高低周期叙事" },
  { id: "street", name: "街哥", description: "裸K结构、真假突破与回踩确认" },
  { id: "jingxin", name: "静心", description: "位置学、右侧确认和风险纪律" },
  { id: "bitlanglang", name: "bit浪浪", description: "市场四季、强势币和节奏判断" },
];

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}
function formatMoney(value: number) { return Number.isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"; }
function orderDisplayPrice(order: AccountOrder) { return order.stopPrice > 0 ? order.stopPrice : order.price; }

export default function TradingTerminal({ initialSymbol }: { initialSymbol: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [interval, setIntervalValue] = useState("15m");
  const [bars, setBars] = useState<MarketBar[]>([]);
  const [marketMode, setMarketMode] = useState<"live" | "unavailable">("unavailable");
  const [marketSource, setMarketSource] = useState<"server" | "browser">("server");
  const [priceTickSize, setPriceTickSize] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AccountResponse>(emptyAccount);
  const [protectionStatuses, setProtectionStatuses] = useState<ProtectionStatusEntry[]>([]);
  const [aiStrongCoins, setAiStrongCoins] = useState<AiStrongCoin[]>([]);
  const [selectedAiSymbol, setSelectedAiSymbol] = useState("");
  const [equityPoints, setEquityPoints] = useState<EquityPoint[]>(() => {
    if (typeof window === "undefined") return [];
    try { return (JSON.parse(window.localStorage.getItem("streetlight-equity-v1") || "[]") as EquityPoint[]).slice(-1000); }
    catch { return []; }
  });
  const [strategy, setStrategy] = useState<Strategy>(defaultStrategy);
  const [indicators, setIndicators] = useState<IndicatorSettings>(defaultIndicators);
  const [overlayVisibility, setOverlayVisibility] = useState<OverlayVisibility>({ positions: true, positionCost: true, limits: true, conditional: true, tpsl: true });
  const [manualStopLines, setManualStopLines] = useState<Record<string, HorizontalStopLine>>({});
  const [drawingHorizontalLine, setDrawingHorizontalLine] = useState(false);
  const [indicatorOpen, setIndicatorOpen] = useState(false);
  const { fontScale } = useFontScale();
  const [symbolQuery, setSymbolQuery] = useState("");
  const [symbolSuggestions, setSymbolSuggestions] = useState<SymbolOption[]>([]);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false);
  const [symbolSearchWarning, setSymbolSearchWarning] = useState("");
  const [strategyPanelWidth, setStrategyPanelWidth] = useState(390);
  const [chartHeight, setChartHeight] = useState(640);
  const [analysisState, setAnalysisState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [analysisSymbol, setAnalysisSymbol] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisResult, setAnalysisResult] = useState<PositionAnalysisResponse | null>(null);
  const [analysisExpertName, setAnalysisExpertName] = useState("四位交易专家");
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);
  const [analysisExpert, setAnalysisExpert] = useState<"all" | ExpertId>("all");
  const [accountTab, setAccountTab] = useState<"positions" | "orders">("positions");
  const [realOrderRouteEnabled, setRealOrderRouteEnabled] = useState(false);
  const [realTradingSwitchOn, setRealTradingSwitchOn] = useState(true);
  const [accountRevision, setAccountRevision] = useState(0);
  const realTradingStatus = resolveRealTradingStatus({ routeEnabled: realOrderRouteEnabled, accountConnected: account.connected, switchOn: realTradingSwitchOn });
  const { themeMode, resolvedTheme, setThemeMode } = useTerminalTheme();
  const [events, setEvents] = useState<EventItem[]>([
    { id: "boot", time: "系统", type: "system", message: "实盘订单仅在你完成最终确认后提交。" },
  ]);
  const previousPositionsRef = useRef<Map<string, AccountPosition>>(new Map());
  const positionsInitializedRef = useRef(false);
  const latestQuoteRef = useRef<{ symbol: string; price: number; mode: "live" | "unavailable" }>({ symbol: initialSymbol, price: 0, mode: "unavailable" });
  const tradeGridRef = useRef<HTMLElement | null>(null);
  const chartWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<"panel" | "chart" | null>(null);
  const indicatorSettingsLoadedRef = useRef("");
  const indicatorSettingsSaveTimerRef = useRef<number | null>(null);
  const liveSwitchPersistenceStartedRef = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LIVE_SWITCH_STORAGE_KEY);
      // Hydrate the browser-only preference after the SSR-safe default is rendered.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "on" || saved === "off") setRealTradingSwitchOn(saved === "on");
    } catch { /* default to on when browser storage is unavailable */ }
  }, []);

  useEffect(() => {
    if (!liveSwitchPersistenceStartedRef.current) {
      liveSwitchPersistenceStartedRef.current = true;
      return;
    }
    try { window.localStorage.setItem(LIVE_SWITCH_STORAGE_KEY, realTradingSwitchOn ? "on" : "off"); }
    catch { /* browser storage is optional */ }
  }, [realTradingSwitchOn]);

  useEffect(() => {
    let active = true;
    fetch("/api/trade/live-status", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { routeEnabled?: boolean } : { routeEnabled: false })
      .then((payload) => { if (active) setRealOrderRouteEnabled(payload.routeEnabled === true); })
      .catch(() => { if (active) setRealOrderRouteEnabled(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    indicatorSettingsLoadedRef.current = "";
    fetch(`/api/trade/indicator-settings?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ settings?: { basis?: "ma" | "ema"; maLength?: number; entryAtrUpper?: number; entryAtrLower?: number; trendAtrEnabled?: boolean; trendAtrMultiplier?: number; atr?: Partial<IndicatorSettings["atr"]>; vegas?: Partial<IndicatorSettings["vegas"]> } | null }> : Promise.reject(new Error("指标参数读取失败")))
      .then((payload) => {
        if (!active) return;
        const saved = payload.settings;
        const savedAtr = saved?.atr;
        const isLegacyDefaultAtr = savedAtr?.upperColor?.toLowerCase() === "#f3c955"
          && savedAtr?.lowerColor?.toLowerCase() === "#f3c955"
          && savedAtr?.upperLineWidth === 1
          && savedAtr?.lowerLineWidth === 1;
        setStrategy((current) => ({ ...current, basis: saved?.basis === "ema" ? "ema" : "ma", maLength: saved?.maLength ?? defaultStrategy.maLength, entryAtrUpper: saved?.entryAtrUpper ?? defaultStrategy.entryAtrUpper, entryAtrLower: saved?.entryAtrLower ?? defaultStrategy.entryAtrLower, trendAtrEnabled: saved?.trendAtrEnabled !== false, trendAtrMultiplier: saved?.trendAtrMultiplier ?? defaultStrategy.trendAtrMultiplier }));
        setIndicators((current) => ({ ...current, ma: { ...current.ma, length: saved?.maLength ?? defaultIndicators.ma.length }, atr: isLegacyDefaultAtr ? defaultIndicators.atr : { ...defaultIndicators.atr, ...savedAtr }, vegas: { ...defaultIndicators.vegas, ...saved?.vegas } }));
        indicatorSettingsLoadedRef.current = symbol;
      })
      .catch(() => { if (active) indicatorSettingsLoadedRef.current = symbol; });
    return () => { active = false; };
  }, [symbol]);

  useEffect(() => {
    if (indicatorSettingsLoadedRef.current !== symbol) return;
    if (indicatorSettingsSaveTimerRef.current !== null) window.clearTimeout(indicatorSettingsSaveTimerRef.current);
    indicatorSettingsSaveTimerRef.current = window.setTimeout(() => {
      void fetch("/api/trade/indicator-settings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, basis: strategy.basis, maLength: strategy.maLength, entryAtrUpper: strategy.entryAtrUpper, entryAtrLower: strategy.entryAtrLower, trendAtrEnabled: strategy.trendAtrEnabled, trendAtrMultiplier: strategy.trendAtrMultiplier, atr: indicators.atr, vegas: indicators.vegas }),
      }).catch(() => undefined);
    }, 350);
    return () => { if (indicatorSettingsSaveTimerRef.current !== null) window.clearTimeout(indicatorSettingsSaveTimerRef.current); };
  }, [symbol, strategy.basis, strategy.maLength, strategy.entryAtrUpper, strategy.entryAtrLower, strategy.trendAtrEnabled, strategy.trendAtrMultiplier, indicators.atr, indicators.vegas]);

  useEffect(() => {
    const query = symbolQuery.trim();
    if (!query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSymbolSearchLoading(true);
      try {
        const response = await fetch(`/api/market/symbols?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as SymbolsResponse;
        if (!response.ok) throw new Error(payload.warning || "币种列表暂不可用");
        setSymbolSuggestions(payload.symbols ?? []);
        setSymbolSearchWarning(payload.warning || "");
      } catch (error) {
        if (!controller.signal.aborted) setSymbolSearchWarning(error instanceof Error ? error.message : "币种列表暂不可用");
      } finally {
        if (!controller.signal.aborted) setSymbolSearchLoading(false);
      }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [symbolQuery]);

  useEffect(() => {
    let active = true;
    fetch("/api/radar", { cache: "no-store" }).then((response) => response.json()).then((radarPayload: { coins?: AiStrongCoin[] }) => {
      if (!active) return;
      setAiStrongCoins((radarPayload.coins ?? []).filter((coin) => coin.participation === "SQUEEZE" || coin.participation === "A").sort((left, right) => right.score - left.score));
    }).catch(() => { if (active) setAiStrongCoins([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (resizeRef.current === "panel" && tradeGridRef.current) {
        const rect = tradeGridRef.current.getBoundingClientRect();
        setStrategyPanelWidth(Math.max(340, Math.min(620, rect.right - event.clientX)));
      }
      if (resizeRef.current === "chart" && chartWorkspaceRef.current) {
        const rect = chartWorkspaceRef.current.getBoundingClientRect();
        setChartHeight(Math.max(360, Math.min(900, event.clientY - rect.top)));
      }
    };
    const stop = () => { resizeRef.current = null; document.body.style.removeProperty("cursor"); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=1000`, { cache: "no-store" });
        let payload: MarketResponse;
        let source: "server" | "browser" = "server";
        if (response.ok) {
          payload = await response.json() as MarketResponse;
        } else {
          payload = await fetchBrowserBinanceKlines(symbol, interval, 1000);
          source = "browser";
        }
        if (!active) return;
        setBars(payload.bars); setMarketMode(payload.mode); setMarketSource(source); setPriceTickSize(payload.priceTickSize ?? null); setUpdatedAt(payload.updatedAt);
        const latest = payload.bars.at(-1);
        if (latest) latestQuoteRef.current = { symbol, price: latest.close, mode: payload.mode };
      } catch {
        if (active) {
          setMarketMode("unavailable"); setBars([]); setPriceTickSize(null);
          setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: "Binance 实时行情连接失败，等待下一轮刷新。" }, ...current].slice(0, 10));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol, interval]);

  useEffect(() => {
    let active = true;
    const loadAccount = () => fetch(`/api/account?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Partial<AccountResponse> & { error?: string };
        if (!response.ok || !payload.account) return { ...emptyAccount, reason: payload.reason ?? payload.error ?? "账户详情需要管理员登录" };
        return payload as AccountResponse;
      })
      .then((payload) => {
        if (!active) return;
        setAccount(payload);
        if (payload.connected) {
          const point = { time: Math.floor(Date.now() / 1000), value: payload.account.totalBalance + payload.account.unrealizedPnl };
          setEquityPoints((current) => {
            const last = current.at(-1);
            if (last && point.time - last.time < 300) return current;
            const next = [...current, point].slice(-1000);
            window.localStorage.setItem("streetlight-equity-v1", JSON.stringify(next));
            return next;
          });
        }
      })
      .catch(() => { if (active) setAccount({ ...emptyAccount, reason: "只读账户接口暂时不可用" }); });
    void loadAccount();
    const timer = window.setInterval(loadAccount, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [accountRevision, symbol]);

  useEffect(() => {
    let active = true;
    fetch("/api/trade/protection-status", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { protections?: ProtectionStatusEntry[] } : { protections: [] })
      .then((payload) => { if (active) setProtectionStatuses(payload.protections ?? []); })
      .catch(() => { if (active) setProtectionStatuses([]); });
    return () => { active = false; };
  }, [accountRevision]);

  const marketState = useMemo(() => {
    const closedBars = bars.filter((bar) => bar.closed);
    const latest = closedBars.at(-1) ?? bars.at(-1);
    const indicator = strategy.basis === "ema"
      ? calculateEma(closedBars, strategy.maLength).at(-1)?.value ?? 0
      : calculateMa(closedBars, strategy.maLength).at(-1)?.value ?? 0;
    const atr = calculateAtr(closedBars, strategy.maLength).at(-1)?.value ?? 0;
    const distance = latest && indicator ? ((latest.close - indicator) / indicator) * 100 : 0;
    const atrDistance = latest && indicator && atr > 0 ? (latest.close - indicator) / atr : null;
    const atrBand = latest && indicator && atr > 0 ? calculateAtrBand(indicator, atr, strategy.entryAtrUpper, strategy.entryAtrLower) : null;
    const lastClose = latest?.close ?? 0;
    const inBand = atrBand ? lastClose >= atrBand.lower && lastClose <= atrBand.upper : Math.abs(distance) <= strategy.entryBandPct;
    const below = atrBand ? lastClose < atrBand.lower : distance < -strategy.entryBandPct;
    const indicatorLabel = `${strategy.basis.toUpperCase()}${strategy.maLength}`;
    return { latest, ma: indicator, atr, atrBand, distance, atrDistance, indicatorLabel, inBand, below, label: inBand ? `进入${indicatorLabel} ATR确认带` : below ? `已跌到${indicatorLabel} ATR下方` : "等待价格回撤" };
  }, [bars, strategy.basis, strategy.maLength, strategy.entryBandPct, strategy.entryAtrUpper, strategy.entryAtrLower]);

  const manualStopLine = manualStopLines[symbol] ?? null;
  const chartOverlays = useMemo<ChartOverlay[]>(() => {
    const result: ChartOverlay[] = [];
    if (overlayVisibility.positions && !overlayVisibility.positionCost) account.positions.filter((item) => item.symbol === symbol).forEach((item) => result.push({
      id: `position-${item.symbol}-${item.positionSide}`, price: item.entryPrice, kind: "position", side: item.side,
      label: `${item.side === "LONG" ? "多仓" : "空仓"} 均价`,
    }));
    if (overlayVisibility.positionCost) account.positions.filter((item) => item.symbol === symbol).forEach((item) => result.push({
      id: `cost-${item.symbol}-${item.positionSide}`, price: item.entryPrice, kind: "cost", side: item.side,
      label: "持仓成本（开仓均价）",
    }));
    if (overlayVisibility.limits) account.limitOrders.filter((item) => item.symbol === symbol).forEach((item) => result.push({
      id: `limit-${item.orderId}`, price: orderDisplayPrice(item), kind: "limit", side: item.side, label: `${item.side === "BUY" ? "限价买" : "限价卖"}`,
    }));
    account.conditionalOrders.filter((item) => item.symbol === symbol).forEach((item) => {
      const isTpSl = item.reduceOnly || item.type.includes("TAKE_PROFIT") || item.type.includes("STOP");
      if ((isTpSl && !overlayVisibility.tpsl) || (!isTpSl && !overlayVisibility.conditional)) return;
      result.push({ id: `condition-${item.orderId}`, price: orderDisplayPrice(item), kind: isTpSl ? "tpsl" : "conditional", side: item.side, label: item.type.replaceAll("_", " ") });
    });
    if (manualStopLine) result.push({ id: `manual-stop-${symbol}`, price: manualStopLine.price, kind: "manual", label: `人工水平止损 · 收盘${manualStopLine.trigger === "BELOW" ? "跌破" : "涨破"}` });
    return result;
  }, [account.positions, account.limitOrders, account.conditionalOrders, manualStopLine, overlayVisibility, symbol]);

  const accountEquity = account.account.totalBalance + account.account.unrealizedPnl;
  const realPosition = account.positions.find((position) => position.symbol === symbol);
  const selectedPosition = realPosition;
  const selectedPositionSource = realPosition ? "binance" as const : undefined;
  const displayedEquity = accountEquity;
  const displayedAvailable = account.account.availableBalance;
  const displayedPnl = account.account.unrealizedPnl;
  const displayedPositions = account.positions.length;
  const displayedOrders = account.limitOrders.length + account.conditionalOrders.length;
  const displayedPoints = equityPoints;
  const displayedConnected = account.connected;
  const equityChange = displayedPoints.length > 1 ? displayedEquity - displayedPoints[0].value : 0;
  const selectedAiCoin = aiStrongCoins.find((coin) => coin.symbol === selectedAiSymbol) ?? aiStrongCoins[0] ?? null;

  function chooseSymbol(next: string) {
    const normalized = next.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!normalized) return;
    const candidate = normalized.endsWith("USDT") || normalized.endsWith("USDC") ? normalized : `${normalized}USDT`;
    let nextSymbol: string;
    try { nextSymbol = normalizeBinanceFuturesSymbol(candidate); }
    catch { return; }
    setLoading(true); setAccount((current) => ({ ...current, currentLeverage: null })); setSymbol(nextSymbol); setSymbolQuery(""); setSymbolSuggestions([]); setSymbolSearchOpen(false);
    const url = new URL(window.location.href); url.searchParams.set("symbol", nextSymbol); window.history.replaceState({}, "", url);
  }
  function updateMaLength(value: number) {
    const length = Math.max(2, Math.min(500, value || 2));
    setStrategy((current) => ({ ...current, maLength: length }));
    setIndicators((current) => ({ ...current, [strategy.basis]: { ...current[strategy.basis], length } }));
  }
 function updateIndicatorLength(key: "ma" | "ema", value: number) {
   const length = Math.max(2, Math.min(500, value || 2));
   setIndicators((current) => ({ ...current, [key]: { ...current[key], length } }));
   if (key === strategy.basis) setStrategy((current) => ({ ...current, maLength: length }));
 }
  function updateVegasLength(key: "fastLength" | "slowLength" | "outerFastLength" | "outerSlowLength", value: number) {
    const length = Math.max(2, Math.min(2_000, value || 2));
    setIndicators((current) => ({ ...current, vegas: { ...current.vegas, [key]: length } }));
  }
  function updateIndicatorBasis(basis: "ma" | "ema") {
    setStrategy((current) => ({ ...current, basis, maLength: indicators[basis].length }));
    setIndicators((current) => ({ ...current, [basis]: { ...current[basis], enabled: true } }));
  }
  function toggleOverlay(key: keyof OverlayVisibility) { setOverlayVisibility((current) => ({ ...current, [key]: !current[key] })); }
  function placeManualStopLine(price: number) {
    if (!Number.isFinite(price) || price <= 0) return;
    const currentPosition = account.positions.find((item) => item.symbol === symbol);
    setManualStopLines((current) => ({
      ...current,
      [symbol]: { price, trigger: current[symbol]?.trigger ?? (currentPosition?.side === "SHORT" ? "ABOVE" : "BELOW") },
    }));
    setDrawingHorizontalLine(false);
  }
  function clearManualStopLine() {
    setManualStopLines((current) => {
      const next = { ...current };
      delete next[symbol];
      return next;
    });
  }
  function updateManualStopTrigger(trigger: HorizontalStopLine["trigger"]) {
    setManualStopLines((current) => current[symbol] ? { ...current, [symbol]: { ...current[symbol], trigger } } : current);
  }
  function beginResize(target: "panel" | "chart") {
    resizeRef.current = target;
    document.body.style.cursor = target === "panel" ? "col-resize" : "row-resize";
  }
  function resetWorkspaceSize() { setStrategyPanelWidth(390); setChartHeight(640); }
  function toggleRealTrading() {
    if (!realOrderRouteEnabled) {
      setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: "实盘开关未启用：服务端交易通道尚未同时开启，币安持仓仅可只读查看。" }, ...current].slice(0, 10));
      return;
    }
    setRealTradingSwitchOn((current) => !current);
  }
  async function closeLive(position: AccountPosition, percent: LiveClosePercent) {
    const clientOrderId = `alexMC${crypto.randomUUID().replaceAll("-", "")}`;
    const response = await fetch("/api/trade/positions/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: position.symbol, positionSide: position.positionSide, percent, clientOrderId, liveSwitchOn: realTradingSwitchOn, confirmation: "CLOSE_MARKET" }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; order?: { orderId?: string | null }; recovered?: boolean };
    if (!response.ok) throw new Error(payload.error || "真实平仓失败");
    const recoveryLabel = payload.recovered ? "（已从订单查询结果确认）" : "";
    setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: `${position.symbol} 已提交真实市价平仓 ${percent}%${recoveryLabel}，订单 ${payload.order?.orderId || "待确认"}。` }, ...current].slice(0, 10));
    setAccountRevision((value) => value + 1);
  }
  function openAnalysisChooser(position: PendingAnalysis) {
    setPendingAnalysis(position); setAnalysisExpert("all");
  }
  function confirmAnalysis() {
    if (!pendingAnalysis) return;
    const position = pendingAnalysis;
    setPendingAnalysis(null);
    void analyzePosition(position, analysisExpert);
  }
  async function analyzePosition(position: PendingAnalysis, selectedExpert: "all" | ExpertId) {
    setAnalysisSymbol(position.symbol); setAnalysisExpertName(expertOptions.find((option) => option.id === selectedExpert)?.name ?? "四位交易专家"); setAnalysisState("loading"); setAnalysisError(""); setAnalysisResult(null);
    try {
      const response = await fetch("/api/trade/position-analysis", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: position.symbol, position, expertId: selectedExpert }),
      });
      const result = await response.json() as PositionAnalysisResponse & { error?: string; code?: string };
      if (!response.ok) throw new Error(result.error || "四专家分析未完成");
      setAnalysisResult(result); setAnalysisState("done");
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "四专家分析未完成"); setAnalysisState("error");
    }
  }
  function runStrategyCheck() {
    const distanceLabel = marketState.latest && marketState.atr > 0
      ? formatAtrDistance(marketState.latest.close, marketState.ma, marketState.atr)
      : "ATR 数据不足";
    const message = marketState.inBand ? `${symbol} ${interval}进入${marketState.indicatorLabel}观察带，当前距离 ${distanceLabel}；尚未成交。`
      : marketState.below ? `${symbol}收盘位于${marketState.indicatorLabel}下方，检查是否满足连续收盘退出条件。`
        : `${symbol}距离${marketState.indicatorLabel} ${distanceLabel}，本轮无触发。`;
    setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: (marketState.inBand ? "candidate" : "check") as EventItem["type"], message }, ...current].slice(0, 10));
  }
  async function recordClosedPosition(position: AccountPosition) {
    try {
      const historyResponse = await fetch(`/api/trade-knowledge?symbol=${encodeURIComponent(position.symbol)}&limit=20`, { cache: "no-store" });
      const history = historyResponse.ok ? await historyResponse.json() as { records?: Array<{ phase: string; score: number }> } : { records: [] };
      const pretrade = history.records?.find((record) => record.phase === "pretrade");
      const provisionalSuccess = position.unrealizedPnl >= 0;
      const score = Math.max(0, Math.min(100, Math.round((pretrade?.score ?? 40) * 0.65 + (provisionalSuccess ? 25 : 8) + (pretrade ? 10 : 0))));
      const mistakes = [
        ...(!pretrade ? ["开仓前没有保存可追溯评分"] : []),
        ...(!provisionalSuccess ? ["退出前处于亏损状态，需要核对是否按计划止损"] : []),
      ];
      const strengths = [
        ...(pretrade ? ["本次交易存在可追溯的操作前评分"] : []),
        ...(provisionalSuccess ? ["仓位消失前保持正向未实现盈亏"] : []),
      ];
      const response = await fetch("/api/trade-knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        symbol: position.symbol, side: position.side, phase: "closed", status: "closed", score,
        outcome: provisionalSuccess ? "success_estimated" : "failure_estimated", pnl: position.unrealizedPnl,
        title: `${position.symbol} 完全退出复盘`, strengths, mistakes,
        summary: `系统检测到仓位在两次账户刷新之间完全退出。退出前未实现盈亏 ${position.unrealizedPnl.toFixed(2)} USDT，暂定为${provisionalSuccess ? "成功" : "失败"}；最终成交结果仍需以后用币安成交回报复核。`,
        plan: { detectedClose: true, previousPosition: position }, evidence: { source: "binance_position_transition", estimated: true },
        sourceRefs: ["操作知识库/退出检测 v1", "系统风险外壳 v1"],
      }) });
      if (response.ok) {
        window.dispatchEvent(new CustomEvent("trade-knowledge-updated"));
        setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: `${position.symbol} 已检测到完全退出，暂定复盘分 ${score}/100。` }, ...current].slice(0, 10));
      }
    } catch {
      setEvents((current) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("zh-CN"), type: "system" as const, message: `${position.symbol} 已完全退出，但自动复盘保存失败。` }, ...current].slice(0, 10));
    }
  }

  useEffect(() => {
    if (!account.connected) {
      positionsInitializedRef.current = false;
      previousPositionsRef.current = new Map();
      return;
    }
    const current = new Map(account.positions.map((position) => [`${position.symbol}:${position.positionSide}`, position]));
    if (!positionsInitializedRef.current) {
      previousPositionsRef.current = current;
      positionsInitializedRef.current = true;
      return;
    }
    for (const [key, position] of current) {
      if (!previousPositionsRef.current.has(key)) {
        void fetch("/api/trade/notifications", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "binance", kind: "POSITION_OPENED", eventId: `opened:${key}:${position.entryPrice}:${position.quantity}`, symbol: position.symbol, side: position.side, price: position.entryPrice, quantity: position.quantity, reason: "账户持仓新增" }),
        }).catch(() => undefined);
      }
    }
    for (const [key, previous] of previousPositionsRef.current) {
      if (!current.has(key)) {
        void recordClosedPosition(previous);
        void fetch("/api/trade/notifications", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "binance", kind: "POSITION_CLOSED", eventId: `closed:${key}:${previous.entryPrice}:${previous.quantity}:${previous.markPrice}`, symbol: previous.symbol, side: previous.side, price: previous.markPrice, quantity: previous.quantity, pnl: previous.unrealizedPnl, reason: "持仓已消失，请核对是否手动卖出、止盈或止损" }),
        }).catch(() => undefined);
      }
    }
    previousPositionsRef.current = current;
  }, [account.connected, account.positions]);

  return (
    <main className={styles.terminalShell} data-theme={resolvedTheme} style={{ "--trade-font-scale": fontScale } as React.CSSProperties}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/"><span>街</span><div><strong>街灯终端</strong><small>STREETLIGHT</small></div></a>
          <nav>
          <a href="/"><b>◎</b>妖币雷达</a><a className={styles.active} href="/trade"><b>⌁</b>合约交易</a>
          <a href="#strategy"><b>◇</b>策略构建</a><a href="#account"><b>▣</b>持仓与订单</a><a href="#trade-knowledge"><b>◫</b>操作知识库</a><a href="/settings"><b>⚙</b>连接设置</a>
        </nav>
        <div className={styles.sidebarFoot}><i className={account.connected ? styles.connected : ""} /><div><strong>{account.connected ? "币安账户已连接" : "币安账户未连接"}</strong><small>{account.connected ? "15秒刷新 · 订单与持仓只读同步" : "连接账户后可建立实盘策略"}</small></div></div>
      </aside>

      <div className={styles.appMain}>
        <header className={styles.topHeader}>
          <div><small>HOME / FUTURES</small><h1>交易工作台</h1></div>
          <div className={styles.headerControls}>
            <div className={styles.themeSwitch} aria-label="主题选择">
              {(["dark", "light", "system"] as ThemeMode[]).map((item) => <button key={item} className={themeMode === item ? styles.selected : ""} onClick={() => setThemeMode(item)}>{item === "dark" ? "深色" : item === "light" ? "浅色" : "跟随系统"}</button>)}
            </div>
            <FontControl />
            <span className={styles.dataStatus}><i className={marketMode === "live" ? styles.connected : ""} />{marketMode === "live" ? marketSource === "browser" ? "BINANCE 实时 · 浏览器直连" : "BINANCE 实时 · 服务端" : "BINANCE 实时行情不可用"}</span>
          </div>
        </header>

        <section className={styles.commandBar}>
          <div className={styles.agentState}><span>{selectedPosition ? "持" : "入"}</span><div><strong>{selectedPosition ? `${displayBinanceSymbol(symbol)} 持仓管理` : "建立实盘新仓计划"}</strong><small>PRE-TRADE SCORE · LIVE ONLY</small></div></div>
          <div className={styles.commandControls}><div className={styles.modeStatus} aria-label="交易模式状态"><span className={realTradingStatus.tone === "live" ? styles.modeLive : styles.modeLocked} role="status" aria-label={`实盘状态：${realTradingStatus.label.replace("实盘：", "")}`}><i />{realTradingStatus.label}</span></div><div className={styles.killSwitch}><span>系统止损保护</span><i className={styles.on} /><button type="button" role="switch" aria-checked={realTradingSwitchOn} aria-label="实盘开关" onClick={toggleRealTrading}>{realTradingSwitchOn ? "实盘开关：开启" : "实盘开关：关闭"}</button><small>{realTradingStatus.detail}</small></div></div>
        </section>

        <section className={styles.topDecisionStrip} aria-label="顶部策略决策">
          <div className={styles.topDecisionHeader}><div><small>DECISION LOG</small><h2>策略决策</h2><p>把高参与候选放在这里；已提交的实盘策略在右侧策略列表查看。</p></div><button onClick={runStrategyCheck}>立即检查</button></div>
          <div className={styles.topDecisionGrid}>
            <section className={styles.decisionBlock}>
              <div><strong>AI强参与币</strong><small>优先观察强共振、逼空或高参与候选 · {aiStrongCoins.length} 个</small></div>
              {aiStrongCoins.length ? <><select aria-label="选择AI强参与币" value={selectedAiCoin?.symbol ?? ""} onChange={(event) => setSelectedAiSymbol(event.target.value)}>{aiStrongCoins.map((coin) => <option key={coin.symbol} value={coin.symbol}>{coin.displayName || displayBinanceSymbol(coin.symbol)} · {Math.round(coin.score)}/100</option>)}</select>{selectedAiCoin && <article><b><a href={`/trade?symbol=${selectedAiCoin.symbol}`}>{selectedAiCoin.displayName || displayBinanceSymbol(selectedAiCoin.symbol)}</a></b><span>{selectedAiCoin.participation} · {Math.round(selectedAiCoin.score)}/100</span><small>{selectedAiCoin.verdict || "等待进一步确认"}</small></article>}</> : <p>暂无 AI 强参与候选</p>}
            </section>
          </div>
        </section>

        <section className={styles.summaryGrid}>
          <article className={styles.balanceCard}><span>币安总权益</span><strong>{displayedConnected ? `${formatMoney(displayedEquity)} USDT` : "— USDT"}</strong><small>{account.connected ? "钱包余额 + 未实现盈亏" : account.reason}</small></article>
          <article className={styles.availableCard}><span>可用资金</span><strong>{displayedConnected ? `${formatMoney(displayedAvailable)} USDT` : "— USDT"}</strong><small>只读接口 · 不暴露密钥</small></article>
          <article className={styles.pnlCard}><span>未实现盈亏</span><strong className={displayedPnl >= 0 ? styles.up : styles.down}>{displayedConnected ? `${displayedPnl >= 0 ? "+" : ""}${formatMoney(displayedPnl)} USDT` : "— USDT"}</strong><small>资金曲线每5分钟留一份本机快照</small></article>
          <article className={styles.positionCard}><span>当前持仓</span><strong>{displayedConnected ? `${displayedPositions} 个` : "—"}</strong><small>{displayedConnected ? `${displayedOrders} 笔活动委托` : "等待账户连接"}</small></article>
        </section>

        <section className={styles.insightGrid}>
          <div className={styles.equityPanel}>
            <div className={styles.sectionHeader}><div><small>BINANCE EQUITY</small><h2>资金曲线</h2></div><div className={styles.equityValue}><strong>{displayedConnected ? formatMoney(displayedEquity) : "0.00"}</strong><span className={equityChange >= 0 ? styles.up : styles.down}>{equityChange >= 0 ? "+" : ""}{formatMoney(equityChange)} USDT</span></div></div>
            <div className={styles.equityChartWrap}><EquityChart points={displayedPoints} theme={resolvedTheme} />{!displayedConnected && <div className={styles.chartEmpty}><strong>连接币安只读账户后开始记录</strong><span>API 密钥仅保存在服务端环境，不进入浏览器。</span></div>}</div>
            <div className={styles.equityStats}><span>峰值<strong>{displayedPoints.length ? formatMoney(Math.max(...displayedPoints.map((point) => point.value))) : formatMoney(displayedEquity)}</strong></span><span>谷值<strong>{displayedPoints.length ? formatMoney(Math.min(...displayedPoints.map((point) => point.value))) : formatMoney(displayedEquity)}</strong></span><span>数据点<strong>{displayedPoints.length}</strong></span><span>账户状态<strong>{account.connected ? "只读已连接" : "未连接"}</strong></span></div>
          </div>
          <div className={styles.logPanel}>
            <div className={styles.sectionHeader}><div><small>DECISION LOG</small><h2>策略决策</h2></div><button onClick={runStrategyCheck}>立即检查</button></div>
            <div className={styles.eventList}>{events.map((event) => <article key={event.id} className={styles[event.type]}><time>{event.time}</time><p>{event.message}</p></article>)}</div>
          </div>
        </section>

        <section ref={tradeGridRef} className={styles.tradeGrid} style={{ gridTemplateColumns: `minmax(0, 1fr) 10px ${strategyPanelWidth}px` }}>
          <div ref={chartWorkspaceRef} className={styles.chartWorkspace} style={{ "--trade-chart-height": `${chartHeight}px` } as React.CSSProperties}>
            <div className={styles.marketHeader}>
              <div className={styles.marketSymbolControls}>
                <div className={styles.symbolPicker}>{quickSymbols.map((item) => <button key={item} className={symbol === item ? styles.selected : ""} onClick={() => chooseSymbol(item)}>{displayBinanceSymbol(item)}</button>)}</div>
                <div className={styles.currentChartSymbol} aria-label={`当前图表币种 ${symbol}`}><strong>{displayBinanceSymbol(symbol)}</strong><small>{quoteAssetForSymbol(symbol) ?? "USDT"} 永续</small></div>
                <div className={styles.symbolSearch}>
                  <input aria-label="搜索币种" value={symbolQuery} onFocus={() => setSymbolSearchOpen(true)} onChange={(event) => { setSymbolQuery(event.target.value); setSymbolSearchOpen(true); }} onKeyDown={(event) => { if (event.key === "Enter") chooseSymbol(event.currentTarget.value); }} placeholder="搜索 BTC、TSLA 或 USDC" autoComplete="off" />
                  {symbolSearchOpen && symbolQuery.trim() && <div className={styles.symbolSuggestions} role="listbox">
                    {symbolSearchLoading && <small>正在匹配 Binance Futures…</small>}
                    {!symbolSearchLoading && symbolSearchWarning && <small>{symbolSearchWarning}</small>}
                    {!symbolSearchLoading && !symbolSearchWarning && symbolSuggestions.length === 0 && <small>没有匹配的 Binance 永续合约</small>}
                    {!symbolSearchLoading && symbolSuggestions.map((item) => <button type="button" role="option" aria-selected="false" key={item.symbol} onClick={() => chooseSymbol(item.symbol)}><strong>{item.displayName}</strong><span>{item.symbol} · {item.quoteAsset ?? quoteAssetForSymbol(item.symbol) ?? "USDT"}</span></button>)}
                  </div>}
                </div>
              </div>
              <div className={styles.quote}><strong>{loading ? "连接中" : `$${formatPrice(marketState.latest?.close ?? 0)}`}</strong><button className={marketState.atrDistance === null ? styles.metricButton : marketState.atrDistance >= 0 ? `${styles.metricButton} ${styles.up}` : `${styles.metricButton} ${styles.down}`} onClick={() => setIndicatorOpen(true)} aria-label="打开均线与ATR设置">距 {marketState.indicatorLabel} {marketState.latest && marketState.atr > 0 ? formatAtrDistance(marketState.latest.close, marketState.ma, marketState.atr) : "ATR 数据不足"}</button><small>{marketState.label}{updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString("zh-CN")}` : ""}</small></div>
            </div>
            <div className={styles.chartToolbar}>
              <div className={styles.intervalButtons}>{intervals.map((item) => <button key={item} className={interval === item ? styles.selected : ""} onClick={() => { setLoading(true); setIntervalValue(item); }}>{item}</button>)}</div>
              <div className={styles.overlayToggles}>
                <MiniToggle label="仓位" active={overlayVisibility.positions} onClick={() => toggleOverlay("positions")} />
                <MiniToggle label="持仓成本" active={overlayVisibility.positionCost} onClick={() => toggleOverlay("positionCost")} />
                <MiniToggle label="限价单" active={overlayVisibility.limits} onClick={() => toggleOverlay("limits")} />
                <MiniToggle label="条件单" active={overlayVisibility.conditional} onClick={() => toggleOverlay("conditional")} />
                <MiniToggle label="止盈止损" active={overlayVisibility.tpsl} onClick={() => toggleOverlay("tpsl")} />
              </div>
              <div className={styles.manualLineControls} aria-label="人工水平止损线">
                <button className={drawingHorizontalLine ? styles.manualLineActive : ""} type="button" onClick={() => setDrawingHorizontalLine((current) => !current)}>{drawingHorizontalLine ? "点击图表放置横线" : "画横线"}</button>
                {manualStopLine && <><span>人工线 {formatPrice(manualStopLine.price)}</span><button type="button" className={manualStopLine.trigger === "BELOW" ? styles.manualLineActive : ""} onClick={() => updateManualStopTrigger("BELOW")}>跌破止损</button><button type="button" className={manualStopLine.trigger === "ABOVE" ? styles.manualLineActive : ""} onClick={() => updateManualStopTrigger("ABOVE")}>涨破止损</button><button type="button" onClick={clearManualStopLine}>清除</button></>}
              </div>
              <button className={styles.indicatorButton} onClick={() => setIndicatorOpen((current) => !current)}>指标 · {Object.values(indicators).filter((item) => "enabled" in item && item.enabled).length}</button>
            </div>
            {indicatorOpen && <IndicatorManager indicators={indicators} basis={strategy.basis} atrUpperMultiplier={strategy.entryAtrUpper} atrLowerMultiplier={strategy.entryAtrLower} trendAtrEnabled={strategy.trendAtrEnabled} trendAtrMultiplier={strategy.trendAtrMultiplier} setIndicators={setIndicators} updateMaLength={updateMaLength} updateIndicatorLength={updateIndicatorLength} updateVegasLength={updateVegasLength} updateBasis={updateIndicatorBasis} updateAtrBand={(upper, lower) => setStrategy((current) => ({ ...current, entryAtrUpper: upper, entryAtrLower: lower }))} updateTrendAtr={(enabled, multiplier) => setStrategy((current) => ({ ...current, trendAtrEnabled: enabled, trendAtrMultiplier: multiplier }))} />}
            <TradeChart bars={bars} fills={account.fills} key={`${symbol}:${interval}`} symbol={symbol} theme={resolvedTheme} indicators={indicators} overlays={chartOverlays} priceTickSize={priceTickSize} indicatorBasis={strategy.basis} atrLength={strategy.maLength} atrUpperMultiplier={strategy.entryAtrUpper} atrLowerMultiplier={strategy.entryAtrLower} trendAtrEnabled={strategy.trendAtrEnabled} trendAtrMultiplier={strategy.trendAtrMultiplier} drawingLine={drawingHorizontalLine} onManualLineChange={placeManualStopLine} />
            <div className={styles.chartResizeHandle} role="separator" aria-label="拖动右下角调整图表高度" title="拖动右下角调整图表高度；双击恢复合适高度" onPointerDown={() => beginResize("chart")} onDoubleClick={resetWorkspaceSize} />
            <div className={styles.chartFoot}><span>TradingView Lightweight Charts · {marketSource === "browser" ? "Binance浏览器直连行情" : "Binance Futures 行情"}</span><span>圆点仅来自 Binance 实际成交回报；买入绿 · 卖出红 · 平仓黄；紫线连接已完整平仓订单的入场/平仓中位价</span></div>
          </div>
          <div className={styles.panelResizeHandle} role="separator" aria-label="拖动调整策略面板宽度" onPointerDown={() => beginResize("panel")} onDoubleClick={resetWorkspaceSize} />
          <AdaptiveStrategyPanel key={`${symbol}:${selectedPosition?.symbol ?? "entry"}`} symbol={symbol} position={selectedPosition} positionSource={selectedPositionSource} interval={interval} accountConnected={account.connected} liveTradingAvailable={realTradingStatus.canPlaceOrders} currentLeverage={account.currentLeverage} currentPrice={marketState.latest?.close ?? 0} maLength={strategy.maLength} maValue={marketState.ma} entryAtrUpper={strategy.entryAtrUpper} entryAtrLower={strategy.entryAtrLower} accountBalance={account.account.availableBalance} onAccountChanged={() => setAccountRevision((value) => value + 1)} />
        </section>

        <section className={styles.accountPanel} id="account">
          <div className={styles.accountHeader}><div><small>BINANCE USDⓈ-M</small><h2>真实持仓与活动委托</h2></div><div className={styles.accountTabs}><button className={accountTab === "positions" ? styles.selected : ""} onClick={() => setAccountTab("positions")}>当前持仓 {displayedPositions}</button><button className={accountTab === "orders" ? styles.selected : ""} onClick={() => setAccountTab("orders")}>活动委托 {displayedOrders}</button></div><span>{account.connected ? `更新 ${new Date(account.updatedAt).toLocaleTimeString("zh-CN")}` : account.reason}</span></div>
          {accountTab === "positions" ? <PositionTable positions={account.positions} protections={protectionStatuses} connected={account.connected} canClose={realTradingStatus.canPlaceOrders} closeDisabledReason={realTradingStatus.detail} onClose={closeLive} onSelectSymbol={chooseSymbol} onAnalyze={(item) => openAnalysisChooser({ symbol: item.symbol, source: "binance", side: item.side, quantity: item.quantity, entryPrice: item.entryPrice, markPrice: item.markPrice, unrealizedPnl: item.unrealizedPnl, leverage: item.leverage, occupiedMargin: item.occupiedMargin, horizontalStopLine: manualStopLines[item.symbol] ?? null })} analysisLoadingSymbol={analysisState === "loading" ? analysisSymbol : ""} onAccountChanged={() => setAccountRevision((value) => value + 1)} /> : <OrderTable orders={[...account.limitOrders, ...account.conditionalOrders]} connected={account.connected} />}
          {analysisState === "loading" && <div className={styles.analysisPanel}><strong>正在调用{analysisExpertName}分析 {displayBinanceSymbol(analysisSymbol)}…</strong><span>读取已收盘行情并生成待审核建议，可能需要一些时间。</span></div>}
          {analysisState === "error" && <div className={styles.analysisPanel}><strong>分析暂未完成</strong><span>{analysisError}</span></div>}
          {analysisState === "done" && analysisResult && <PositionAnalysisPanel result={analysisResult} onClose={() => { setAnalysisResult(null); setAnalysisState("idle"); }} />}
        </section>

        {pendingAnalysis && <div className={styles.analysisChooserBackdrop} role="presentation" onMouseDown={() => setPendingAnalysis(null)}><section className={styles.analysisChooser} role="dialog" aria-modal="true" aria-labelledby="analysis-chooser-title" onMouseDown={(event) => event.stopPropagation()}><div className={styles.analysisChooserHeader}><div><small>POSITION ANALYSIS</small><h2 id="analysis-chooser-title">选择分析体系</h2><p>{displayBinanceSymbol(pendingAnalysis.symbol)} · {pendingAnalysis.side === "LONG" ? "做多" : "做空"} · 只读取已收盘行情</p>{pendingAnalysis.horizontalStopLine && <p>人工水平止损线：{formatPrice(pendingAnalysis.horizontalStopLine.price)} · 收盘{pendingAnalysis.horizontalStopLine.trigger === "BELOW" ? "跌破" : "涨破"}触发，已传给 AI</p>}</div><button onClick={() => setPendingAnalysis(null)} aria-label="关闭分析选择">×</button></div><div className={styles.analysisChooserOptions}>{expertOptions.map((option) => <button key={option.id} className={analysisExpert === option.id ? styles.analysisChooserSelected : ""} onClick={() => setAnalysisExpert(option.id)}><strong>{option.name}</strong><span>{option.description}</span></button>)}</div><footer className={styles.analysisChooserFooter}><span>不会自动挂单，真实交易接口保持锁定。</span><div><button onClick={() => setPendingAnalysis(null)}>取消</button><button className={styles.analysisChooserPrimary} onClick={confirmAnalysis}>开始分析</button></div></footer></section></div>}

        <TradeKnowledgePanel symbol={symbol} />

        <footer className={styles.tradeFooter}>实盘限价策略和市价平仓均需通过服务端实盘开关与最终确认；订单状态以 Binance 实际回报为准。</footer>
      </div>
    </main>
  );
}

function MiniToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? styles.toggleActive : ""} onClick={onClick}><i />{label}</button>;
}

function IndicatorManager({ indicators, basis, atrUpperMultiplier, atrLowerMultiplier, trendAtrEnabled, trendAtrMultiplier, setIndicators, updateMaLength, updateIndicatorLength, updateVegasLength, updateBasis, updateAtrBand, updateTrendAtr }: { indicators: IndicatorSettings; basis: "ma" | "ema"; atrUpperMultiplier: number; atrLowerMultiplier: number; trendAtrEnabled: boolean; trendAtrMultiplier: number; setIndicators: React.Dispatch<React.SetStateAction<IndicatorSettings>>; updateMaLength: (value: number) => void; updateIndicatorLength: (key: "ma" | "ema", value: number) => void; updateVegasLength: (key: "fastLength" | "slowLength" | "outerFastLength" | "outerSlowLength", value: number) => void; updateBasis: (basis: "ma" | "ema") => void; updateAtrBand: (upper: number, lower: number) => void; updateTrendAtr: (enabled: boolean, multiplier: number) => void }) {
  const toggle = (key: "ma" | "ema" | "vegas" | "avwap" | "volumeProfile") => setIndicators((current) => ({ ...current, [key]: { ...current[key], enabled: !current[key].enabled } }));
  return <div className={styles.indicatorManager}>
    <div className={styles.indicatorBasis}><strong>策略均线</strong><label>类型<select value={basis} onChange={(event) => updateBasis(event.target.value as "ma" | "ema")}><option value="ma">MA</option><option value="ema">EMA</option></select></label><label>周期<input type="number" min="2" max="500" value={indicators[basis].length} onChange={(event) => updateMaLength(Number(event.target.value))} /></label><div className={styles.atrBandControls}><strong>ATR入场确认带</strong><label>上方 ATR<input aria-label="上方 ATR" type="number" min="0" step="0.1" value={atrUpperMultiplier} onChange={(event) => updateAtrBand(Math.max(0, Number(event.target.value) || 0), atrLowerMultiplier)} />×</label><label>上方线颜色<input aria-label="ATR上方线颜色" type="color" value={indicators.atr.upperColor} onChange={(event) => setIndicators((current) => ({ ...current, atr: { ...current.atr, upperColor: event.target.value } }))} /></label><label>上方线粗细<select aria-label="ATR上方线粗细" value={indicators.atr.upperLineWidth} onChange={(event) => setIndicators((current) => ({ ...current, atr: { ...current.atr, upperLineWidth: Number(event.target.value) as 1 | 2 | 3 | 4 } }))}><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option></select></label><label>下方 ATR<input aria-label="下方 ATR" type="number" min="0" step="0.1" value={atrLowerMultiplier} onChange={(event) => updateAtrBand(atrUpperMultiplier, Math.max(0, Number(event.target.value) || 0))} />×</label><label>下方线颜色<input aria-label="ATR下方线颜色" type="color" value={indicators.atr.lowerColor} onChange={(event) => setIndicators((current) => ({ ...current, atr: { ...current.atr, lowerColor: event.target.value } }))} /></label><label>下方线粗细<select aria-label="ATR下方线粗细" value={indicators.atr.lowerLineWidth} onChange={(event) => setIndicators((current) => ({ ...current, atr: { ...current.atr, lowerLineWidth: Number(event.target.value) as 1 | 2 | 3 | 4 } }))}><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option></select></label><small>价格确认区间：均线 ± ATR 倍数；每个币种单独保存</small></div><small>当前距离按 ATR 倍数显示</small></div>
    <div className={styles.trendAtrControls}><label><input aria-label="趋势 ATR" type="checkbox" checked={trendAtrEnabled} onChange={(event) => updateTrendAtr(event.target.checked, trendAtrMultiplier)} />趋势 ATR×3</label><label>倍数<input aria-label="趋势 ATR 倍数" type="number" min="0" step="0.1" value={trendAtrMultiplier} onChange={(event) => updateTrendAtr(trendAtrEnabled, Math.max(0, Number(event.target.value) || 0))} /></label></div>
    <IndicatorRow name="MA" description="简单移动平均线与策略入场带" enabled={indicators.ma.enabled} onToggle={() => toggle("ma")}>
      <label>周期<input type="number" min="2" max="500" value={indicators.ma.length} onChange={(event) => updateIndicatorLength("ma", Number(event.target.value))} /></label><label>颜色<input type="color" value={indicators.ma.color} onChange={(event) => setIndicators((current) => ({ ...current, ma: { ...current.ma, color: event.target.value } }))} /></label><label>粗细<select value={indicators.ma.lineWidth} onChange={(event) => setIndicators((current) => ({ ...current, ma: { ...current.ma, lineWidth: Number(event.target.value) as 1 | 2 | 3 | 4 } }))}><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option></select></label>
    </IndicatorRow>
   <IndicatorRow name="EMA" description="指数移动平均线" enabled={indicators.ema.enabled} onToggle={() => toggle("ema")}>
     <label>周期<input type="number" min="2" max="500" value={indicators.ema.length} onChange={(event) => updateIndicatorLength("ema", Number(event.target.value))} /></label><label>颜色<input type="color" value={indicators.ema.color} onChange={(event) => setIndicators((current) => ({ ...current, ema: { ...current.ema, color: event.target.value } }))} /></label><label>粗细<select value={indicators.ema.lineWidth} onChange={(event) => setIndicators((current) => ({ ...current, ema: { ...current.ema, lineWidth: Number(event.target.value) as 1 | 2 | 3 | 4 } }))}><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option></select></label>
   </IndicatorRow>
    <IndicatorRow name="Vegas Channel" description="EMA144/EMA169 与 EMA576/EMA676 双通道，仅图表研究" enabled={indicators.vegas.enabled} onToggle={() => toggle("vegas")}>
      <label>EMA144 周期<input type="number" min="2" max="2000" value={indicators.vegas.fastLength} onChange={(event) => updateVegasLength("fastLength", Number(event.target.value))} /></label><label>EMA169 周期<input type="number" min="2" max="2000" value={indicators.vegas.slowLength} onChange={(event) => updateVegasLength("slowLength", Number(event.target.value))} /></label><label>EMA576 周期<input type="number" min="2" max="2000" value={indicators.vegas.outerFastLength} onChange={(event) => updateVegasLength("outerFastLength", Number(event.target.value))} /></label><label>EMA676 周期<input type="number" min="2" max="2000" value={indicators.vegas.outerSlowLength} onChange={(event) => updateVegasLength("outerSlowLength", Number(event.target.value))} /></label>
      <label>内通道颜色<input type="color" value={indicators.vegas.firstColor} onChange={(event) => setIndicators((current) => ({ ...current, vegas: { ...current.vegas, firstColor: event.target.value } }))} /></label><label>外通道颜色<input type="color" value={indicators.vegas.secondColor} onChange={(event) => setIndicators((current) => ({ ...current, vegas: { ...current.vegas, secondColor: event.target.value } }))} /></label><label>线条粗细<select value={indicators.vegas.lineWidth} onChange={(event) => setIndicators((current) => ({ ...current, vegas: { ...current.vegas, lineWidth: Number(event.target.value) as 1 | 2 | 3 | 4 } }))}><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option></select></label>
    </IndicatorRow>
   <IndicatorRow name="Anchored VWAP" description="锚定最近一段K线的成交量加权均价" enabled={indicators.avwap.enabled} onToggle={() => toggle("avwap")}>
      <label>锚定根数<input type="number" min="10" max="300" value={indicators.avwap.anchorBars} onChange={(event) => setIndicators((current) => ({ ...current, avwap: { ...current.avwap, anchorBars: Number(event.target.value) } }))} /></label><label>价格源<select value={indicators.avwap.source} onChange={(event) => setIndicators((current) => ({ ...current, avwap: { ...current.avwap, source: event.target.value as "hlc3" | "close" } }))}><option value="hlc3">HLC3</option><option value="close">Close</option></select></label><label>颜色<input type="color" value={indicators.avwap.color} onChange={(event) => setIndicators((current) => ({ ...current, avwap: { ...current.avwap, color: event.target.value } }))} /></label><label>粗细<select value={indicators.avwap.lineWidth} onChange={(event) => setIndicators((current) => ({ ...current, avwap: { ...current.avwap, lineWidth: Number(event.target.value) as 1 | 2 | 3 | 4 } }))}><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option></select></label>
    </IndicatorRow>
    <IndicatorRow name="Fixed Range Volume Profile" description="固定区间成交量分布与POC" enabled={indicators.volumeProfile.enabled} onToggle={() => toggle("volumeProfile")}>
      <label>区间根数<input type="number" min="20" max="300" value={indicators.volumeProfile.rangeBars} onChange={(event) => setIndicators((current) => ({ ...current, volumeProfile: { ...current.volumeProfile, rangeBars: Number(event.target.value) } }))} /></label><label>行数<input type="number" min="8" max="80" value={indicators.volumeProfile.rows} onChange={(event) => setIndicators((current) => ({ ...current, volumeProfile: { ...current.volumeProfile, rows: Number(event.target.value) } }))} /></label>
    </IndicatorRow>
  </div>;
}

function IndicatorRow({ name, description, enabled, onToggle, children }: { name: string; description: string; enabled: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <article className={enabled ? styles.enabledIndicator : ""}><button onClick={onToggle}><i />{name}<small>{description}</small></button><div>{children}</div></article>;
}

function ClosePositionAction({ symbol, quantity, canClose, disabledReason, onClose }: { symbol: string; quantity: number; canClose: boolean; disabledReason?: string; onClose: (percent: LiveClosePercent) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [selectedPercent, setSelectedPercent] = useState<LiveClosePercent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirmClose() {
    if (!selectedPercent || !canClose || busy) return;
    setBusy(true); setError("");
    try { await onClose(selectedPercent); setOpen(false); setSelectedPercent(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "平仓失败"); }
    finally { setBusy(false); }
  }
  return <div className={styles.closeAction}>
    <button className={styles.closeButton} type="button" onClick={() => { setOpen((value) => !value); setError(""); }} aria-expanded={open}>平仓</button>
    {open && <div className={styles.closePopover} role="dialog" aria-label={`${symbol} 市价平仓`}>
      <strong>市价平仓</strong><small>真实账户 · 服务端重新读取持仓 · 当前数量 {quantity}</small>
      <div className={styles.closePercentages}>{LIVE_CLOSE_PERCENT_OPTIONS.map((percent) => <button type="button" key={percent} className={selectedPercent === percent ? styles.closePercentSelected : ""} onClick={() => setSelectedPercent(percent)}>{percent}%</button>)}</div>
      {!canClose && <p className={styles.closeHint}>{disabledReason || "当前不可平仓"}</p>}
      {selectedPercent && <button type="button" className={styles.closeConfirmButton} disabled={!canClose || busy} onClick={() => void confirmClose()}>{busy ? "提交中…" : `确认市价平仓 ${selectedPercent}%`}</button>}
      {error && <p className={styles.closeError}>{error}</p>}
    </div>}
  </div>;
}

type ManualProtectionCandidate = {
  candidateId: string;
  sourceFillId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  sourceOrderIds: string[];
  manualAliasIds?: string[];
  totalQuantity?: number;
  totalNotional?: number;
  totalMargin?: number;
  otherQuantity?: number;
  otherNotional?: number;
  otherMargin?: number;
  manualNotional?: number;
  manualMargin?: number;
  reconciliationRequired?: boolean;
};

function ManualProtectionAction({ symbol, side, canSubmit, disabledReason, onChanged }: { symbol: string; side: "LONG" | "SHORT"; canSubmit: boolean; disabledReason?: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidate, setCandidate] = useState<ManualProtectionCandidate | null>(null);
  const [protectionKind, setProtectionKind] = useState<"TP" | "SL" | null>(null);
  const [strategyType, setStrategyType] = useState<"DEFAULT_TP" | "FIXED_TP" | "MA_SL" | "LEVEL_SL" | null>(null);
  const [fixedPrice, setFixedPrice] = useState("");
  const [timeframe, setTimeframe] = useState("1h");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  async function loadCandidate() {
    setOpen(true); setLoading(true); setCandidate(null); setProtectionKind(null); setStrategyType(null); setMessage("");
    try {
      const response = await fetch(`/api/trade/manual-protection?symbol=${encodeURIComponent(symbol)}&side=${side}`, { cache: "no-store" });
      const payload = await response.json() as { connected?: boolean; positions?: ManualProtectionCandidate[]; reason?: string; error?: string };
      if (!response.ok || !payload.connected) throw new Error(payload.error || payload.reason || "手动持仓查询失败");
      setCandidate(payload.positions?.[0] ?? null);
      if (!payload.positions?.length) setMessage("当前没有可挂保护策略的手动来源持仓。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "手动持仓查询失败"); }
    finally { setLoading(false); }
  }

  async function submit() {
    if (!candidate || !strategyType || !canSubmit || candidate.reconciliationRequired || busy) return;
    if ((strategyType === "FIXED_TP" || strategyType === "LEVEL_SL") && !(Number(fixedPrice) > 0)) { setMessage("请输入大于 0 的保护触发价格"); return; }
    setBusy(true); setMessage("");
    const nextKey = idempotencyKey || `web:manual-protection:${crypto.randomUUID()}`;
    setIdempotencyKey(nextKey);
    try {
      const response = await fetch("/api/trade/manual-protection", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, side, strategyType, ...(strategyType === "FIXED_TP" || strategyType === "LEVEL_SL" ? { fixedPrice: Number(fixedPrice) } : {}), ...(strategyType === "MA_SL" ? { timeframe } : {}), confirmation: "CONFIRM_MANUAL_PROTECTION", idempotencyKey: nextKey }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; strategy?: { id?: string } };
      if (!response.ok || !payload.strategy) throw new Error(payload.error || "保护策略提交失败");
      setMessage(`已提交保护策略 ${payload.strategy.id || ""}，请核对 Binance 条件单。`); onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保护策略提交失败"); }
    finally { setBusy(false); }
  }

  return <div className={styles.manualProtectionAction}>
    <button className={styles.manualProtectionButton} type="button" onClick={() => { if (open) setOpen(false); else void loadCandidate(); }}>手动保护</button>
    {open && <div className={styles.manualProtectionPopover} role="dialog" aria-label={`${symbol} 手动持仓保护`}>
      <div className={styles.manualProtectionHeader}><strong>手动持仓保护</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭手动保护">×</button></div>
      {loading && <p className={styles.manualProtectionHint}>正在重新读取 Binance 持仓与来源订单…</p>}
      {!loading && candidate && <>
        <p className={styles.manualProtectionIdentity}>{candidate.symbol} · {candidate.side === "LONG" ? "做多" : "做空"} · 本次只保护手动来源</p>
        <div className={styles.manualProtectionBreakdown}><span>估算保证金<strong>{formatMoney(candidate.manualMargin ?? candidate.quantity * candidate.markPrice / Math.max(candidate.leverage, 1))} USDT</strong></span></div>
        {!protectionKind && <div className={styles.manualProtectionChoices}><button type="button" onClick={() => setProtectionKind("TP")}>止盈</button><button type="button" onClick={() => setProtectionKind("SL")}>止损</button></div>}
        {protectionKind === "TP" && !strategyType && <div className={styles.manualProtectionChoices}><button type="button" onClick={() => setStrategyType("DEFAULT_TP")}>默认止盈</button><button type="button" onClick={() => setStrategyType("FIXED_TP")}>固定止盈</button></div>}
        {protectionKind === "SL" && !strategyType && <div className={styles.manualProtectionChoices}><button type="button" onClick={() => setStrategyType("MA_SL")}>均线默认止损</button><button type="button" onClick={() => setStrategyType("LEVEL_SL")}>固定价格止损</button></div>}
        {strategyType === "MA_SL" && <div className={styles.manualProtectionTimeframes}>{(["5m", "15m", "1h", "4h", "1d"] as const).map((value) => <button type="button" key={value} className={timeframe === value ? styles.manualProtectionSelected : ""} onClick={() => setTimeframe(value)}>{value}</button>)}</div>}
        {(strategyType === "FIXED_TP" || strategyType === "LEVEL_SL") && <label className={styles.manualProtectionField}>触发价格<input value={fixedPrice} onChange={(event) => setFixedPrice(event.target.value)} inputMode="decimal" placeholder="请输入价格" /></label>}
        {candidate.reconciliationRequired && <p className={styles.manualProtectionError}>手动来源总量大于当前持仓，无法安全区分，已禁止提交。</p>}
        {!canSubmit && <p className={styles.manualProtectionHint}>{disabledReason || "实盘保护通道当前不可用"}</p>}
        {strategyType && !candidate.reconciliationRequired && <button className={styles.manualProtectionConfirm} type="button" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "提交中…" : "确认设置保护单"}</button>}
      </>}
      {message && <p className={styles.manualProtectionMessage}>{message}</p>}
    </div>}
  </div>;
}

function PositionTable({ positions, protections, connected, canClose, closeDisabledReason, onClose, onSelectSymbol, onAnalyze, analysisLoadingSymbol, onAccountChanged }: { positions: AccountPosition[]; protections: ProtectionStatusEntry[]; connected: boolean; canClose: boolean; closeDisabledReason: string; onClose: (position: AccountPosition, percent: LiveClosePercent) => Promise<void>; onSelectSymbol: (symbol: string) => void; onAnalyze: (position: AccountPosition) => void; analysisLoadingSymbol: string; onAccountChanged: () => void }) {
  if (!connected || !positions.length) return <div className={styles.tableEmpty}><strong>{connected ? "当前没有合约持仓" : "币安账户尚未连接"}</strong><span>{connected ? "有持仓后会实时显示均价、标记价、盈亏和爆仓价。" : "在服务端配置 API 后，这里不会使用演示数据。"}</span></div>;
  return <div className={styles.tableWrap}><table><thead><tr><th>分析</th><th>保护</th><th>合约</th><th>方向</th><th>数量</th><th>开仓均价</th><th>标记价格</th><th>实际占用保证金</th><th>未实现盈亏</th><th>爆仓价格</th><th>杠杆</th><th>手动保护</th><th>平仓</th></tr></thead><tbody>{positions.map((item) => { const protectedQuantity = protections.filter((protection) => protection.symbol === item.symbol && protection.side === item.side).reduce((total, protection) => total + protection.protectedQuantity, 0); const protectedPercent = Math.min(100, Math.round(protectedQuantity / item.quantity * 100)); return <tr key={`${item.symbol}-${item.positionSide}`}><td><button className={styles.analysisButton} onClick={() => onAnalyze(item)} disabled={analysisLoadingSymbol === item.symbol}>{analysisLoadingSymbol === item.symbol ? "分析中" : "分析"}</button></td><td>{protectedPercent > 0 && <span className={styles.protectionBadge}><i className={styles.protectionLight} />保护中 {protectedPercent}%</span>}</td><td><button className={styles.symbolLink} onClick={() => onSelectSymbol(item.symbol)}><strong>{displayBinanceSymbol(item.symbol)}</strong><small>{quoteAssetForSymbol(item.symbol) ?? "USDT"} 永续</small></button></td><td className={item.side === "LONG" ? styles.up : styles.down}>{item.side === "LONG" ? "做多" : "做空"}</td><td>{item.quantity}</td><td>{formatPrice(item.entryPrice)}</td><td>{formatPrice(item.markPrice)}</td><td>{item.occupiedMargin === null ? "未知" : `${formatMoney(item.occupiedMargin)} USDT`}</td><td className={item.unrealizedPnl >= 0 ? styles.up : styles.down}>{item.unrealizedPnl >= 0 ? "+" : ""}{formatMoney(item.unrealizedPnl)}</td><td>{formatPrice(item.liquidationPrice)}</td><td>{item.leverage}x</td><td><ManualProtectionAction symbol={item.symbol} side={item.side} canSubmit={canClose} disabledReason={closeDisabledReason} onChanged={onAccountChanged} /></td><td><ClosePositionAction symbol={item.symbol} quantity={item.quantity} canClose={canClose} disabledReason={closeDisabledReason} onClose={(percent) => onClose(item, percent)} /></td></tr>; })}</tbody></table></div>;
}

function OrderTable({ orders, connected }: { orders: AccountOrder[]; connected: boolean }) {
  if (!connected || !orders.length) return <div className={styles.tableEmpty}><strong>{connected ? "当前没有活动委托" : "币安只读账户尚未连接"}</strong><span>{connected ? "限价单、条件单和止盈止损单会在这里与K线同步显示。" : "密钥只放服务端，并保持交易与提现权限关闭。"}</span></div>;
  return <div className={styles.tableWrap}><table><thead><tr><th>网站订单号</th><th>时间</th><th>合约</th><th>方向</th><th>类型</th><th>触发/委托价</th><th>已成交/总量</th><th>只减仓</th><th>状态</th></tr></thead><tbody>{orders.map((item) => <tr key={item.orderId}><td><strong>{item.websiteOrderId || "—"}</strong><small>币安 {item.orderId}</small></td><td>{new Date(item.updateTime).toLocaleString("zh-CN", { hour12: false })}</td><td><strong>{displayBinanceSymbol(item.symbol)}</strong><small>{quoteAssetForSymbol(item.symbol) ?? "USDT"} 永续</small></td><td className={item.side === "BUY" ? styles.up : styles.down}>{item.side === "BUY" ? "买入" : "卖出"}</td><td>{item.type.replaceAll("_", " ")}</td><td>{formatPrice(orderDisplayPrice(item))}</td><td>{item.executedQuantity} / {item.quantity}</td><td>{item.reduceOnly ? "是" : "否"}</td><td>{item.status}</td></tr>)}</tbody></table></div>;
}

function PositionAnalysisPanel({ result, onClose }: { result: PositionAnalysisResponse; onClose: () => void }) {
  const direction = result.plan.direction === "LONG" ? "建议做多" : result.plan.direction === "SHORT" ? "建议做空" : "观望 / 待复核";
  const reviewLabel = result.experts.length === 1
    ? `${result.experts[0]?.name ?? "单专家"} POSITION REVIEW`
    : "FOUR-EXPERT POSITION REVIEW";

  return <section className={styles.analysisPanel} aria-label="交易分析结果">
    <div className={styles.analysisHeader}><div><small>{reviewLabel} · {displayBinanceSymbol(result.symbol)}</small><h3>{direction}</h3><p>{result.plan.note}</p></div><button onClick={onClose}>收起</button></div>
    <div className={styles.analysisPlan}><article><span>建议挂单金额</span><strong>{result.plan.suggestedMarginUsdt === null ? "暂无统一建议" : `${formatMoney(result.plan.suggestedMarginUsdt)} USDT`}</strong></article><article><span>建议止损价</span><strong>{result.plan.suggestedStopPrice === null ? "待复核" : formatPrice(result.plan.suggestedStopPrice)}</strong></article><article><span>建议止盈价</span><strong>{result.plan.suggestedTakeProfitPrice === null ? "待复核" : formatPrice(result.plan.suggestedTakeProfitPrice)}</strong></article><article><span>共识</span><strong>{result.consensus.strength} · {result.consensus.validOpinions}/4</strong></article></div>
    {result.horizontalStopLine && <p className={styles.analysisWarning}>人工水平止损线：{formatPrice(result.horizontalStopLine.price)} · 收盘{result.horizontalStopLine.trigger === "BELOW" ? "跌破" : "涨破"}时进入全部止损复核；AI 已识别，系统不会自动执行。</p>}
    {result.warnings.map((warning) => <p className={styles.analysisWarning} key={warning}>! {warning}</p>)}
    <div className={styles.expertAnalysisGrid}>{result.experts.map((expert) => <article key={expert.id}><header><strong>{expert.name}</strong><b className={expert.direction === "LONG" ? styles.up : expert.direction === "SHORT" ? styles.down : ""}>{expert.direction === "LONG" ? "做多" : expert.direction === "SHORT" ? "做空" : "中性"}</b></header><h4>{expert.setupName}</h4><p>保证金 {expert.marginUsdt === null ? "未知" : `${formatMoney(expert.marginUsdt)} USDT`} · 止损 {expert.stopPrice === null ? "未知" : formatPrice(expert.stopPrice)} · 止盈 {expert.targetPrice === null ? "未知" : formatPrice(expert.targetPrice)}</p><small>{[...expert.evidence, ...expert.risks, ...expert.unknowns].slice(0, 3).join("；") || "暂无可展示的补充依据"}</small></article>)}</div>
    <footer>仅生成待审核分析计划；不会自动挂单，真实交易接口保持锁定。</footer>
  </section>;
}
