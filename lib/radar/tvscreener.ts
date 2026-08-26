import { randomUUID } from "node:crypto";

export type TvScreenerCoverage = "live" | "partial" | "stale" | "unavailable";

type TvScreenerInterval = "5" | "15" | "60" | "240" | "1D";
type TvScreenerField =
  | "PRICE"
  | "CHANGE_PERCENT"
  | "VOLUME"
  | "RELATIVE_VOLUME"
  | "RSI_14"
  | "MACD_12_26"
  | "SMA_30"
  | "EMA_30"
  | "ATR_14";
type TvScreenerSortBy = "VOLUME" | "CHANGE_PERCENT" | "RSI_14";

export type TvScreenerRequest = {
  assetType: "crypto";
  symbols: string[];
  intervals: TvScreenerInterval[];
  fields: TvScreenerField[];
  sortBy: TvScreenerSortBy;
  limit: number;
};

export type TvScreenerRow = {
  tvSymbol: string;
  exchange: string | null;
  rawSymbol: string | null;
  binanceSymbol: string | null;
  values: Record<string, number | string | null>;
  intervalValues: Record<string, Record<string, number | null>>;
  warnings: string[];
};

export type TvScreenerResponse = {
  source: "tradingview-screener";
  requestId: string;
  fetchedAt: string;
  coverage: TvScreenerCoverage;
  rows: TvScreenerRow[];
  warnings: string[];
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8791";
const SCREEN_PATH = "/v1/screen";
const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SYMBOLS = 50;
const MAX_ROWS = 25;
const MAX_WARNING_LENGTH = 240;
const MAX_WARNINGS = 100;

const REQUEST_KEYS = new Set(["assetType", "symbols", "intervals", "fields", "sortBy", "limit"]);
const ALLOWED_INTERVALS = new Set(["5", "15", "60", "240", "1D"]);
const ALLOWED_FIELDS = new Set([
  "PRICE",
  "CHANGE_PERCENT",
  "VOLUME",
  "RELATIVE_VOLUME",
  "RSI_14",
  "MACD_12_26",
  "SMA_30",
  "EMA_30",
  "ATR_14",
]);
const ALLOWED_SORT_KEYS = new Set(["VOLUME", "CHANGE_PERCENT", "RSI_14"]);
const COVERAGES = new Set(["live", "partial", "stale", "unavailable"]);
const SENSITIVE_WARNING_PATTERN = /(authorization|cookie|password|secret|token|api[-_ ]?key|private[-_ ]?key)/i;

type UnknownRecord = Record<string, unknown>;
type CacheEntry = { response: TvScreenerResponse; cachedAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TvScreenerResponse>>();

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(message: string): never {
  throw new TypeError(`Invalid tvscreener request: ${message}`);
}

function readAllowedStringArray(
  input: UnknownRecord,
  key: string,
  allowed: ReadonlySet<string>,
  minimum: number,
  maximum?: number,
): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.length < minimum) {
    invalidRequest(`${key} must be a non-empty array`);
  }
  if (maximum !== undefined && value.length > maximum) {
    invalidRequest(`${key} must contain at most ${maximum} items`);
  }
  if (!value.every((item): item is string => typeof item === "string")) {
    invalidRequest(`${key} must contain strings`);
  }
  for (const item of value) {
    if (!allowed.has(item)) invalidRequest(`${key} contains an unsupported value`);
  }
  return [...value];
}

export function validateTvScreenerRequest(input: unknown): TvScreenerRequest {
  if (!isRecord(input)) invalidRequest("must be an object");

  const unknownKey = Object.keys(input).find((key) => !REQUEST_KEYS.has(key));
  if (unknownKey) invalidRequest(`unknown field ${unknownKey}`);

  if (input.assetType !== "crypto") invalidRequest("assetType must be crypto");

  const symbols = input.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > MAX_SYMBOLS) {
    invalidRequest(`symbols must contain between 1 and ${MAX_SYMBOLS} items`);
  }
  if (!symbols.every((item): item is string => typeof item === "string" && item.trim().length > 0)) {
    invalidRequest("symbols must contain non-empty strings");
  }

  const intervals = readAllowedStringArray(input, "intervals", ALLOWED_INTERVALS, 1);
  const fields = readAllowedStringArray(input, "fields", ALLOWED_FIELDS, 1);

  if (typeof input.sortBy !== "string" || !ALLOWED_SORT_KEYS.has(input.sortBy)) {
    invalidRequest("sortBy contains an unsupported value");
  }
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_ROWS) {
    invalidRequest(`limit must be an integer between 1 and ${MAX_ROWS}`);
  }

  return {
    assetType: "crypto",
    symbols: [...symbols],
    intervals: intervals as TvScreenerInterval[],
    fields: fields as TvScreenerField[],
    sortBy: input.sortBy as TvScreenerSortBy,
    limit: input.limit,
  };
}

function fingerprint(request: TvScreenerRequest): string {
  return JSON.stringify({
    assetType: request.assetType,
    symbols: [...request.symbols].sort(),
    intervals: [...request.intervals].sort(),
    fields: [...request.fields].sort(),
    sortBy: request.sortBy,
    limit: request.limit,
  });
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;

  const octets = normalized.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

function sidecarBaseUrl(): string {
  const configured = process.env.TVSCREENER_BASE_URL?.trim();
  const candidate = configured || DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("TVSCREENER_BASE_URL is not a valid loopback URL");
  }

  if (
    parsed.protocol !== "http:" ||
    !isLoopbackHostname(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("TVSCREENER_BASE_URL must be an HTTP loopback URL");
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function safeWarning(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const warning = value.trim();
  if (!warning) return null;
  if (SENSITIVE_WARNING_PATTERN.test(warning)) return "Sensitive upstream warning omitted";
  return warning.slice(0, MAX_WARNING_LENGTH);
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const warnings: string[] = [];
  for (const item of value) {
    const warning = safeWarning(item);
    if (warning && !warnings.includes(warning)) warnings.push(warning);
    if (warnings.length >= MAX_WARNINGS) break;
  }
  return warnings;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, MAX_WARNING_LENGTH) : null;
}

function normalizeValue(value: unknown, warnings: string[], label: string): number | string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    warnings.push(`${label} is unavailable`);
    return null;
  }
  if (typeof value === "string") return value.slice(0, MAX_WARNING_LENGTH);
  warnings.push(`${label} is unavailable`);
  return null;
}

function normalizeValues(value: unknown, warnings: string[]): Record<string, number | string | null> {
  if (!isRecord(value)) return {};
  const values: Record<string, number | string | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    values[key] = normalizeValue(item, warnings, `field ${key}`);
  }
  return values;
}

function normalizeIntervalValues(
  value: unknown,
  warnings: string[],
): Record<string, Record<string, number | null>> {
  if (!isRecord(value)) return {};
  const intervalValues: Record<string, Record<string, number | null>> = {};
  for (const [interval, rawValues] of Object.entries(value)) {
    if (!ALLOWED_INTERVALS.has(interval) || !isRecord(rawValues)) continue;
    const values: Record<string, number | null> = {};
    for (const [field, item] of Object.entries(rawValues)) {
      if (!ALLOWED_FIELDS.has(field)) continue;
      if (item === null) {
        values[field] = null;
      } else if (typeof item === "number" && Number.isFinite(item)) {
        values[field] = item;
      } else {
        values[field] = null;
        warnings.push(`${interval}/${field} is unavailable`);
      }
    }
    intervalValues[interval] = values;
  }
  return intervalValues;
}

function normalizeRow(value: unknown): TvScreenerRow {
  if (!isRecord(value) || typeof value.tvSymbol !== "string" || value.tvSymbol.length === 0) {
    throw new Error("sidecar returned an invalid row");
  }

  const warnings = normalizeWarnings(value.warnings);
  const row: TvScreenerRow = {
    tvSymbol: value.tvSymbol.slice(0, MAX_WARNING_LENGTH),
    exchange: normalizeString(value.exchange),
    rawSymbol: normalizeString(value.rawSymbol),
    binanceSymbol: normalizeString(value.binanceSymbol),
    values: normalizeValues(value.values, warnings),
    intervalValues: normalizeIntervalValues(value.intervalValues, warnings),
    warnings,
  };
  return row;
}

function normalizeCoverage(value: unknown, warnings: string[], rows: TvScreenerRow[]): TvScreenerCoverage {
  if (value === undefined) return warnings.length > 0 || rows.some((row) => row.warnings.length > 0) ? "partial" : "live";
  if (typeof value !== "string" || !COVERAGES.has(value)) throw new Error("sidecar returned an invalid coverage");
  return value as TvScreenerCoverage;
}

function normalizeResponse(payload: unknown, requestId: string, fetchedAt: string): TvScreenerResponse {
  if (!isRecord(payload) || !Array.isArray(payload.rows) || payload.rows.length > MAX_ROWS) {
    throw new Error("sidecar returned an invalid response");
  }

  const rows = payload.rows.map(normalizeRow);
  const warnings = normalizeWarnings(payload.warnings);
  return {
    source: "tradingview-screener",
    requestId,
    fetchedAt,
    coverage: normalizeCoverage(payload.coverage, warnings, rows),
    rows,
    warnings,
  };
}

class SidecarHttpError extends Error {
  readonly status: number | null;

  constructor(status: unknown) {
    super("TradingView sidecar returned a non-success status");
    this.name = "SidecarHttpError";
    this.status = typeof status === "number" && Number.isInteger(status) ? status : null;
  }
}

async function requestSidecar(request: TvScreenerRequest): Promise<unknown> {
  const baseUrl = sidecarBaseUrl();
  const response = await fetch(`${baseUrl}${SCREEN_PATH}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      assetType: request.assetType,
      symbols: request.symbols,
      intervals: request.intervals,
      fields: request.fields,
      sortBy: request.sortBy,
      limit: request.limit,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new SidecarHttpError(response.status);
  return response.json();
}

function failureWarning(error: unknown): string {
  if (error instanceof SidecarHttpError && error.status !== null) {
    return `TradingView sidecar unavailable (HTTP ${error.status})`;
  }
  if (error instanceof Error && error.message === "TVSCREENER_BASE_URL must be an HTTP loopback URL") {
    return "TradingView sidecar URL must be an HTTP loopback URL";
  }
  if (error instanceof Error && error.message === "TVSCREENER_BASE_URL is not a valid loopback URL") {
    return "TradingView sidecar URL is invalid";
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "TradingView sidecar request timed out";
  }
  return "TradingView sidecar unavailable";
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

function unavailableResponse(requestId: string, fetchedAt: string, error: unknown): TvScreenerResponse {
  return {
    source: "tradingview-screener",
    requestId,
    fetchedAt,
    coverage: "unavailable",
    rows: [],
    warnings: [failureWarning(error)],
  };
}

function staleResponse(previous: TvScreenerResponse, requestId: string, error: unknown): TvScreenerResponse {
  return {
    source: previous.source,
    requestId,
    fetchedAt: previous.fetchedAt,
    coverage: "stale",
    rows: previous.rows,
    warnings: uniqueWarnings([...previous.warnings, failureWarning(error)]),
  };
}

async function loadResponse(
  request: TvScreenerRequest,
  previous: TvScreenerResponse | undefined,
): Promise<TvScreenerResponse> {
  const requestId = randomUUID();
  const fetchedAt = new Date(Date.now()).toISOString();
  try {
    const payload = await requestSidecar(request);
    const response = normalizeResponse(payload, requestId, fetchedAt);
    if (response.coverage === "live" || response.coverage === "partial") {
      cache.set(fingerprint(request), { response, cachedAt: Date.now() });
    }
    return response;
  } catch (error) {
    if (previous && (previous.coverage === "live" || previous.coverage === "partial")) {
      return staleResponse(previous, requestId, error);
    }
    return unavailableResponse(requestId, fetchedAt, error);
  }
}

export async function screenWithTvScreener(request: TvScreenerRequest): Promise<TvScreenerResponse> {
  const validatedRequest = validateTvScreenerRequest(request);
  const key = fingerprint(validatedRequest);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.response;

  const current = inFlight.get(key);
  if (current) return current;

  const previous = cached?.response;
  const pending = loadResponse(validatedRequest, previous);
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}
