import json
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager

import pytest

from services.tvscreener.config import ConfigError, Settings
from services.tvscreener.normalizer import RequestValidationError, normalize_frame, validate_request
from services.tvscreener.server import SidecarService, create_server


DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class FakeFrame:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]
        self.columns = tuple(dict.fromkeys(key for row in self.rows for key in row))
        self.attrs = {}

    def iterrows(self):
        yield from enumerate(self.rows)


def request_payload(**overrides):
    payload = {
        "assetType": "crypto",
        "symbols": ["BINANCE:BTCUSDT"],
        "intervals": ["15", "60"],
        "fields": ["PRICE", "CHANGE_PERCENT", "RSI_14", "MACD_12_26"],
        "sortBy": "VOLUME",
        "limit": 25,
    }
    payload.update(overrides)
    return payload


class RecordingProvider:
    def __init__(self, frame=None, error=None):
        self.frame = frame
        self.error = error
        self.calls = 0
        self.requests = []

    def __call__(self, request):
        self.calls += 1
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.frame


@contextmanager
def running_sidecar(provider):
    service = SidecarService(provider=provider, settings=Settings(port=0))
    httpd = create_server(service)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address
        yield f"http://{host}:{port}", service
    finally:
        httpd.shutdown()
        thread.join(timeout=2)
        httpd.server_close()


def get_json(base_url, path):
    with DIRECT_OPENER.open(f"{base_url}{path}", timeout=2) as response:
        return response.status, json.loads(response.read())


def post_json(base_url, payload, headers=None):
    request = urllib.request.Request(
        f"{base_url}/v1/screen",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with DIRECT_OPENER.open(request, timeout=2) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_settings_are_loopback_only_and_use_the_sidecar_timeout():
    settings = Settings.from_env({"TVSCREENER_HOST": "127.0.0.1", "TVSCREENER_PORT": "8891"})

    assert settings.host == "127.0.0.1"
    assert settings.port == 8891
    assert settings.upstream_timeout_seconds == 10
    assert settings.breaker_failure_threshold == 3
    assert settings.breaker_cooldown_seconds == 30

    with pytest.raises(ConfigError):
        Settings.from_env({"TVSCREENER_HOST": "0.0.0.0"})


@pytest.mark.parametrize(
    "overrides",
    [
        {"filters": []},
        {"query": {"where": []}},
        {"assetType": "stock"},
        {"intervals": ["1"]},
        {"fields": ["UNKNOWN_FIELD"]},
        {"sortBy": "PRICE"},
        {"limit": 26},
        {"symbols": [f"BINANCE:TOKEN{i}USDT" for i in range(51)]},
    ],
)
def test_closed_schema_rejects_arbitrary_filters_and_unsupported_values(overrides):
    with pytest.raises(RequestValidationError):
        validate_request(request_payload(**overrides))


def test_http_schema_rejection_does_not_call_provider_or_echo_request_headers():
    provider = RecordingProvider(frame=FakeFrame([]))
    with running_sidecar(provider) as (base_url, _service):
        status, body = post_json(
            base_url,
            request_payload(filters=[{"left": "PRICE", "operation": ">", "right": 1}]),
            headers={"X-Test-Secret": "request-header-secret"},
        )

    assert status == 400
    assert provider.calls == 0
    assert "request-header-secret" not in json.dumps(body)


def test_screen_returns_the_closed_response_and_row_shapes():
    provider = RecordingProvider(
        frame=FakeFrame(
            [
                {
                    "Symbol": "BINANCE:BTCUSDT",
                    "Exchange": "BINANCE",
                    "Name": "BTCUSDT",
                    "close": 100.5,
                    "change": 1.25,
                    "RSI|15": 42.0,
                    "RSI|60": 45.0,
                    "MACD.macd|15": 0.5,
                    "MACD.macd|60": 0.7,
                }
            ]
        )
    )
    with running_sidecar(provider) as (base_url, _service):
        status, body = post_json(base_url, request_payload())
        health_status, health = get_json(base_url, "/healthz")

    assert status == 200
    assert set(body) == {"source", "requestId", "fetchedAt", "coverage", "rows", "warnings"}
    assert body["source"] == "tradingview-screener"
    assert body["coverage"] in {"live", "partial"}
    assert len(body["rows"]) == 1
    assert set(body["rows"][0]) == {
        "tvSymbol",
        "exchange",
        "rawSymbol",
        "binanceSymbol",
        "values",
        "intervalValues",
        "warnings",
    }
    assert provider.requests == [validate_request(request_payload())]
    assert health_status == 200
    assert health["lastSuccessAt"] is not None


def test_normalizer_turns_nan_null_and_missing_values_into_null_with_warnings():
    request = validate_request(request_payload())
    frame = FakeFrame(
        [
            {
                "Symbol": "BINANCE:BTCUSDT",
                "Exchange": "BINANCE",
                "Name": "BTCUSDT",
                "close": 100.5,
                "change": float("nan"),
                "RSI|15": 42.0,
                "MACD.macd|15": float("inf"),
                "RSI|60": None,
            }
        ]
    )

    rows, warnings = normalize_frame(frame, request)

    row = rows[0]
    assert row["tvSymbol"] == "BINANCE:BTCUSDT"
    assert row["exchange"] == "BINANCE"
    assert row["rawSymbol"] == "BTCUSDT"
    assert row["binanceSymbol"] == "BTCUSDT"
    assert row["values"]["PRICE"] == 100.5
    assert row["values"]["CHANGE_PERCENT"] is None
    assert row["intervalValues"]["15"]["RSI_14"] == 42.0
    assert row["intervalValues"]["15"]["MACD_12_26"] is None
    assert row["intervalValues"]["60"]["RSI_14"] is None
    assert any("CHANGE_PERCENT" in warning for warning in row["warnings"])
    assert any("MACD_12_26" in warning for warning in row["warnings"])
    assert any("RSI_14" in warning for warning in row["warnings"])
    assert warnings == []
    assert all(value != 0 for value in row["values"].values() if value is not None)


def test_unsupported_requested_data_field_is_null_with_a_warning():
    request = validate_request(
        request_payload(fields=["PRICE", "ATR_14"], intervals=["15"])
    )
    frame = FakeFrame(
        [{"Symbol": "BINANCE:BTCUSDT", "Exchange": "BINANCE", "Name": "BTCUSDT", "close": 100.5}]
    )

    rows, _warnings = normalize_frame(frame, request)

    assert rows[0]["values"]["ATR_14"] is None
    assert rows[0]["intervalValues"]["15"]["ATR_14"] is None
    assert any("ATR_14" in warning for warning in rows[0]["warnings"])


def test_interval_technical_fields_do_not_reuse_unqualified_values():
    request = validate_request(request_payload(fields=["RSI_14"], intervals=["15", "60"]))
    frame = FakeFrame(
        [{"Symbol": "BINANCE:BTCUSDT", "Exchange": "BINANCE", "Name": "BTCUSDT", "RSI": 42.0}]
    )

    rows, _warnings = normalize_frame(frame, request)

    row = rows[0]
    assert row["values"]["RSI_14"] == 42.0
    assert row["intervalValues"]["15"]["RSI_14"] is None
    assert row["intervalValues"]["60"]["RSI_14"] is None
    assert any("15/RSI_14" in warning for warning in row["warnings"])
    assert any("60/RSI_14" in warning for warning in row["warnings"])


def test_daily_interval_uses_default_daily_screener_fields():
    request = validate_request(
        request_payload(
            intervals=["1D"],
            fields=["PRICE", "RSI_14", "SMA_30", "EMA_30", "ATR_14"],
        )
    )
    frame = FakeFrame(
        [
            {
                "Symbol": "BINANCE:HEMIUSDT",
                "Exchange": "BINANCE",
                "Name": "HEMIUSDT",
                "close": 0.01047,
                "close|1D": None,
                "RSI": 67.9,
                "RSI|1D": None,
                "SMA30": 0.00652,
                "SMA30|1D": None,
                "EMA30": 0.00714,
                "EMA30|1D": None,
                "ATR": 0.00168,
                "ATR|1D": None,
            }
        ]
    )

    rows, _warnings = normalize_frame(frame, request)

    assert rows[0]["intervalValues"]["1D"] == {
        "PRICE": 0.01047,
        "RSI_14": 67.9,
        "SMA_30": 0.00652,
        "EMA_30": 0.00714,
        "ATR_14": 0.00168,
    }
    assert not any(warning.startswith("1D/") for warning in rows[0]["warnings"])


def test_unmapped_symbol_is_preserved_in_the_normalized_rows():
    request = validate_request(request_payload(symbols=["KRAKEN:BTCUSD"], fields=["PRICE"]))
    frame = FakeFrame(
        [{"Symbol": "KRAKEN:BTCUSD", "Exchange": "KRAKEN", "Name": "BTCUSD", "close": 99.0}]
    )

    rows, _warnings = normalize_frame(frame, request)

    assert len(rows) == 1
    assert rows[0]["tvSymbol"] == "KRAKEN:BTCUSD"
    assert rows[0]["exchange"] == "KRAKEN"
    assert rows[0]["rawSymbol"] == "BTCUSD"
    assert rows[0]["binanceSymbol"] is None
    assert any("mapping" in warning.lower() for warning in rows[0]["warnings"])


def test_three_consecutive_failures_open_a_30_second_breaker_without_leaking_secrets_or_headers():
    provider = RecordingProvider(error=RuntimeError("upstream secret: do-not-leak"))
    with running_sidecar(provider) as (base_url, _service):
        for _attempt in range(3):
            status, body = post_json(
                base_url,
                request_payload(),
                headers={"Authorization": "Bearer request-header-secret"},
            )
            assert status == 503
            assert "do-not-leak" not in json.dumps(body)
            assert "request-header-secret" not in json.dumps(body)

        status, body = post_json(base_url, request_payload())
        health_status, health = get_json(base_url, "/healthz")

    assert status == 503
    assert "do-not-leak" not in json.dumps(body)
    assert provider.calls == 3
    assert health_status == 200
    assert set(health) == {"service", "version", "tvscreenerVersion", "lastSuccessAt", "breaker"}
    assert health["breaker"]["state"] == "open"
    assert health["breaker"]["consecutiveFailures"] == 3
    assert health["breaker"]["cooldownSeconds"] == 30
    assert health["lastSuccessAt"] is None
    assert "do-not-leak" not in json.dumps(health)
    assert "request-header-secret" not in json.dumps(health)
