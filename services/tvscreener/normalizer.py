"""Closed request validation and safe TradingView row normalization."""

from __future__ import annotations

import math
import numbers
import re
from collections.abc import Iterable, Mapping
from typing import Any


REQUEST_KEYS = frozenset({"assetType", "symbols", "intervals", "fields", "sortBy", "limit"})
SUPPORTED_INTERVALS = frozenset({"5", "15", "60", "240", "1D"})
SUPPORTED_FIELDS = frozenset(
    {
        "PRICE",
        "CHANGE_PERCENT",
        "VOLUME",
        "RELATIVE_VOLUME",
        "RSI_14",
        "MACD_12_26",
        "SMA_30",
        "EMA_30",
        "ATR_14",
    }
)
SUPPORTED_SORT_KEYS = frozenset({"VOLUME", "CHANGE_PERCENT", "RSI_14"})
MAX_SYMBOLS = 50
MAX_ROWS = 25


class RequestValidationError(ValueError):
    """Raised when a request is outside the Task 1 closed wire contract."""


FIELD_ATTR_CANDIDATES: dict[str, tuple[str, ...]] = {
    "PRICE": ("PRICE",),
    "CHANGE_PERCENT": ("CHANGE_PERCENT",),
    "VOLUME": ("VOLUME", "VOLUME_24H_IN_USD"),
    "RELATIVE_VOLUME": ("RELATIVE_VOLUME", "RELATIVE_VOLUME_10D_CALC"),
    "RSI_14": ("RELATIVE_STRENGTH_INDEX_14", "RSI_14"),
    "MACD_12_26": ("MACD_LEVEL_12_26", "MACD_12_26"),
    "SMA_30": ("SIMPLE_MOVING_AVERAGE_30", "SMA_30"),
    "EMA_30": ("EXPONENTIAL_MOVING_AVERAGE_30", "EMA_30"),
    "ATR_14": ("AVERAGE_TRUE_RANGE_14", "ATR_14"),
}

# These columns do not represent a different indicator calculation per
# interval. If the screener returns only an unqualified value, it is safe to
# reuse it in each requested interval while keeping technical fields strict.
STATIC_INTERVAL_FIELDS = frozenset({"PRICE", "CHANGE_PERCENT", "VOLUME", "RELATIVE_VOLUME"})

FIELD_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "PRICE": ("close", "Close", "PRICE", "Price"),
    "CHANGE_PERCENT": ("change", "Change", "CHANGE_PERCENT", "Change %"),
    "VOLUME": ("volume", "Volume", "VOLUME", "Volume 24h in USD", "24h_vol|5"),
    "RELATIVE_VOLUME": (
        "relative_volume_10d_calc",
        "Relative Volume",
        "RELATIVE_VOLUME",
        "Relative Vol",
    ),
    "RSI_14": (
        "RSI",
        "RSI14",
        "RSI_14",
        "Relative Strength Index (14)",
    ),
    "MACD_12_26": (
        "MACD.macd",
        "MACD",
        "MACD_LEVEL_12_26",
        "MACD_12_26",
        "MACD Level (12, 26)",
    ),
    "SMA_30": (
        "SMA30",
        "SMA_30",
        "Simple Moving Average (30)",
    ),
    "EMA_30": (
        "EMA30",
        "EMA_30",
        "Exponential Moving Average (30)",
    ),
    "ATR_14": (
        "ATR",
        "ATR14",
        "ATR_14",
        "Average True Range (14)",
    ),
}

_MISSING = object()
_SYMBOL_PATTERN = re.compile(r"^[A-Z0-9]+(?:USDT|USDC)$")


def _invalid(message: str) -> RequestValidationError:
    return RequestValidationError(message)


def _read_string_array(payload: Mapping[str, Any], key: str, allowed: frozenset[str]) -> list[str]:
    value = payload.get(key)
    if not isinstance(value, list) or not value:
        raise _invalid(f"{key} must be a non-empty array")
    if not all(isinstance(item, str) for item in value):
        raise _invalid(f"{key} must contain strings")
    unsupported = next((item for item in value if item not in allowed), None)
    if unsupported is not None:
        raise _invalid(f"{key} contains an unsupported value")
    return list(value)


def validate_request(payload: Any) -> dict[str, Any]:
    """Validate and copy the exact six-field request contract."""

    if not isinstance(payload, Mapping):
        raise _invalid("request must be an object")

    unknown = sorted(set(payload) - REQUEST_KEYS)
    if unknown:
        raise _invalid("request contains an unknown field")
    if payload.get("assetType") != "crypto":
        raise _invalid("assetType must be crypto")

    symbols = payload.get("symbols")
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= MAX_SYMBOLS:
        raise _invalid(f"symbols must contain between 1 and {MAX_SYMBOLS} items")
    if not all(isinstance(symbol, str) and bool(symbol.strip()) for symbol in symbols):
        raise _invalid("symbols must contain non-empty strings")

    intervals = _read_string_array(payload, "intervals", SUPPORTED_INTERVALS)
    fields = _read_string_array(payload, "fields", SUPPORTED_FIELDS)

    sort_by = payload.get("sortBy")
    if not isinstance(sort_by, str) or sort_by not in SUPPORTED_SORT_KEYS:
        raise _invalid("sortBy contains an unsupported value")

    limit = payload.get("limit")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_ROWS:
        raise _invalid(f"limit must be an integer between 1 and {MAX_ROWS}")

    return {
        "assetType": "crypto",
        "symbols": list(symbols),
        "intervals": intervals,
        "fields": fields,
        "sortBy": sort_by,
        "limit": limit,
    }


def _row_mapping(row: Any) -> Mapping[Any, Any]:
    if isinstance(row, Mapping):
        return row
    to_dict = getattr(row, "to_dict", None)
    if callable(to_dict):
        converted = to_dict()
        if isinstance(converted, Mapping):
            return converted
    return {}


def _original_columns(frame: Any) -> Mapping[Any, Any]:
    attrs = getattr(frame, "attrs", None)
    if not isinstance(attrs, Mapping):
        return {}
    original = attrs.get("original_columns", {})
    return original if isinstance(original, Mapping) else {}


def _candidate_keys(frame: Any, aliases: Iterable[str]) -> list[str]:
    original = _original_columns(frame)
    keys: list[str] = []
    for alias in aliases:
        if alias not in keys:
            keys.append(alias)
        display = original.get(alias)
        if isinstance(display, str) and display not in keys:
            keys.append(display)
    return keys


def _read_value(frame: Any, row: Mapping[Any, Any], aliases: Iterable[str]) -> Any:
    row_keys = list(row.keys())
    for candidate in _candidate_keys(frame, aliases):
        if candidate in row:
            return row[candidate]
        candidate_lower = candidate.lower()
        for row_key in row_keys:
            if isinstance(row_key, str) and row_key.lower() == candidate_lower:
                return row[row_key]
    return _MISSING


def _is_non_finite(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, numbers.Number):
        try:
            return not math.isfinite(float(value))
        except (TypeError, ValueError, OverflowError):
            return True
    try:
        comparison = value != value
        return isinstance(comparison, bool) and comparison
    except (TypeError, ValueError):
        return False


def _finite_number(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, numbers.Number):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(numeric):
        return None
    if isinstance(value, numbers.Integral):
        return int(value)
    return numeric


def _add_warning(warnings: list[str], warning: str) -> None:
    if warning not in warnings:
        warnings.append(warning)


def _value_aliases(
    field: str,
    interval: str | None = None,
    allow_static_fallback: bool = False,
) -> tuple[str, ...]:
    aliases = FIELD_COLUMN_ALIASES[field]
    if interval is None:
        return aliases
    qualified = tuple(f"{alias}|{interval}" for alias in aliases)
    return qualified + aliases if allow_static_fallback else qualified


def _normalize_field_value(
    frame: Any,
    row: Mapping[Any, Any],
    field: str,
    warnings: list[str],
    interval: str | None = None,
    allow_static_fallback: bool = False,
) -> float | int | None:
    aliases = _value_aliases(field, interval, allow_static_fallback)
    value = _read_value(frame, row, aliases)

    # tvscreener 0.4.0 emits a qualified ``|1D`` column for daily requests,
    # but TradingView currently leaves that column null. The unqualified
    # CryptoScreener field is the package's default daily timeframe (the same
    # value shown as the plain field in the raw response), so use it only for
    # the explicit daily protocol interval. Intraday intervals remain strict.
    if interval == "1D" and allow_static_fallback and (value is _MISSING or value is None or _is_non_finite(value)):
        fallback = _read_value(frame, row, FIELD_COLUMN_ALIASES[field])
        if fallback is not _MISSING:
            value = fallback

    if value is _MISSING and interval is not None and allow_static_fallback:
        value = _read_value(frame, row, FIELD_COLUMN_ALIASES[field])

    label = f"{interval + '/' if interval else ''}{field}"
    if value is _MISSING:
        _add_warning(warnings, f"{label} is unavailable or unsupported")
        return None
    if value is None:
        _add_warning(warnings, f"{label} is null")
        return None
    if _is_non_finite(value):
        _add_warning(warnings, f"{label} is non-finite")
        return None
    normalized = _finite_number(value)
    if normalized is None:
        _add_warning(warnings, f"{label} is unavailable")
        return None
    return normalized


def _text_value(value: Any) -> str | None:
    if value is _MISSING or value is None:
        return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _metadata_value(frame: Any, row: Mapping[Any, Any], aliases: Iterable[str]) -> str | None:
    value = _read_value(frame, row, aliases)
    return _text_value(value)


def _map_binance_symbol(tv_symbol: str | None, exchange: str | None, raw_symbol: str | None) -> str | None:
    if not tv_symbol or not exchange or not raw_symbol:
        return None
    if exchange.upper() != "BINANCE" or not tv_symbol.upper().startswith("BINANCE:"):
        return None
    candidate = raw_symbol.upper()
    if not _SYMBOL_PATTERN.fullmatch(candidate):
        return None
    return candidate


def _normalize_row(frame: Any, index: Any, row_value: Any, request: Mapping[str, Any], ordinal: int) -> dict[str, Any]:
    row = _row_mapping(row_value)
    warnings: list[str] = []

    tv_symbol = _metadata_value(frame, row, ("symbol", "Symbol", "ticker", "Ticker", "pro_name", "Pro Name"))
    if tv_symbol is None and isinstance(index, str) and ":" in index:
        tv_symbol = index.strip() or None
    if tv_symbol is None and ordinal < len(request["symbols"]):
        tv_symbol = request["symbols"][ordinal]
        _add_warning(warnings, "tvSymbol was missing; requested symbol used")
    if tv_symbol is None:
        tv_symbol = "UNKNOWN"
        _add_warning(warnings, "tvSymbol is unavailable")

    exchange = _metadata_value(frame, row, ("exchange", "Exchange", "EXCHANGE"))
    if exchange is None and ":" in tv_symbol:
        exchange = tv_symbol.split(":", 1)[0] or None

    raw_symbol = _metadata_value(
        frame,
        row,
        (
            "ticker",
            "Ticker",
            "short_name",
            "Short Name",
            "rawSymbol",
            "raw_symbol",
            "name",
            "Name",
            "description",
            "Description",
        ),
    )
    if ":" in tv_symbol:
        symbol_suffix = tv_symbol.split(":", 1)[1] or None
        if raw_symbol is None or not _SYMBOL_PATTERN.fullmatch(raw_symbol.upper()):
            raw_symbol = symbol_suffix

    binance_symbol = _map_binance_symbol(tv_symbol, exchange, raw_symbol)
    if binance_symbol is None:
        _add_warning(warnings, "Binance symbol mapping unavailable")

    values: dict[str, float | int | None] = {}
    for field in request["fields"]:
        values[field] = _normalize_field_value(frame, row, field, warnings)

    interval_values: dict[str, dict[str, float | int | None]] = {}
    for interval in request["intervals"]:
        interval_values[interval] = {}
        for field in request["fields"]:
            interval_values[interval][field] = _normalize_field_value(
                frame,
                row,
                field,
                warnings,
                interval=interval,
                allow_static_fallback=interval == "1D" or field in STATIC_INTERVAL_FIELDS,
            )

    return {
        "tvSymbol": tv_symbol,
        "exchange": exchange,
        "rawSymbol": raw_symbol,
        "binanceSymbol": binance_symbol,
        "values": values,
        "intervalValues": interval_values,
        "warnings": warnings,
    }


def normalize_frame(frame: Any, request: Mapping[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """Convert a tvscreener DataFrame into the stable row shape.

    The function deliberately treats absent, null, NaN, infinity, and
    unsupported columns as unavailable values. It never substitutes zero.
    """

    validated = validate_request(request)
    global_warnings: list[str] = []
    if frame is None:
        return [], ["TradingView returned no data"]

    iterator = getattr(frame, "iterrows", None)
    if not callable(iterator):
        raise TypeError("TradingView result is not a DataFrame-like object")

    rows: list[dict[str, Any]] = []
    for ordinal, (index, row_value) in enumerate(iterator()):
        if ordinal >= validated["limit"]:
            _add_warning(global_warnings, f"TradingView result truncated to {validated['limit']} rows")
            break
        rows.append(_normalize_row(frame, index, row_value, validated, ordinal))

    if not rows:
        _add_warning(global_warnings, "TradingView returned no rows")
    return rows, global_warnings


# Explicit alias for callers that prefer the response terminology.
normalize_rows = normalize_frame
