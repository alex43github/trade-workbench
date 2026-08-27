"""Loopback-only HTTP sidecar for read-only TradingView screener data."""

from __future__ import annotations

import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import RLock
from typing import Any, Callable, Mapping

try:
    from .config import (
        BREAKER_COOLDOWN_SECONDS,
        BREAKER_FAILURE_THRESHOLD,
        LOOPBACK_HOST,
        SERVICE_NAME,
        SERVICE_VERSION,
        TVSCREENER_VERSION,
        Settings,
    )
    from .normalizer import (
        FIELD_ATTR_CANDIDATES,
        RequestValidationError,
        normalize_frame,
        validate_request,
    )
except ImportError:  # pragma: no cover - supports ``python server.py``.
    from config import (  # type: ignore[no-redef]
        BREAKER_COOLDOWN_SECONDS,
        BREAKER_FAILURE_THRESHOLD,
        LOOPBACK_HOST,
        SERVICE_NAME,
        SERVICE_VERSION,
        TVSCREENER_VERSION,
        Settings,
    )
    from normalizer import (  # type: ignore[no-redef]
        FIELD_ATTR_CANDIDATES,
        RequestValidationError,
        normalize_frame,
        validate_request,
    )


class UpstreamUnavailableError(RuntimeError):
    """An upstream screen failed without exposing its underlying details."""


class CircuitOpenError(UpstreamUnavailableError):
    """The upstream circuit is open and the request was rejected locally."""


class CircuitBreaker:
    """Thread-safe consecutive-failure circuit breaker."""

    def __init__(
        self,
        failure_threshold: int = BREAKER_FAILURE_THRESHOLD,
        cooldown_seconds: float = BREAKER_COOLDOWN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._lock = RLock()
        self._consecutive_failures = 0
        self._opened_at: float | None = None
        self._half_open_probe = False

    def allow_request(self) -> bool:
        with self._lock:
            if self._opened_at is None:
                return True

            elapsed = self._clock() - self._opened_at
            if elapsed < self.cooldown_seconds:
                return False
            if self._half_open_probe:
                return False
            self._half_open_probe = True
            return True

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._opened_at = None
            self._half_open_probe = False

    def record_failure(self) -> None:
        with self._lock:
            if self._opened_at is not None or self._half_open_probe:
                self._consecutive_failures = self.failure_threshold
                self._opened_at = self._clock()
                self._half_open_probe = False
                return

            self._consecutive_failures += 1
            if self._consecutive_failures >= self.failure_threshold:
                self._opened_at = self._clock()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            state = "closed"
            if self._opened_at is not None:
                state = "open"
                if self._clock() - self._opened_at >= self.cooldown_seconds:
                    state = "half_open"
            return {
                "state": state,
                "consecutiveFailures": self._consecutive_failures,
                "cooldownSeconds": self.cooldown_seconds,
            }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _call_provider(provider: Any, request: Mapping[str, Any]) -> Any:
    screen = getattr(provider, "screen", None)
    if callable(screen):
        return screen(request)
    if callable(provider):
        return provider(request)
    raise TypeError("provider is not callable")


class SidecarService:
    """Application service shared by the HTTP handler and local tests."""

    def __init__(
        self,
        provider: Any | None = None,
        settings: Settings | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.settings = settings or Settings()
        self.provider = provider if provider is not None else TvScreenerProvider(
            timeout_seconds=self.settings.upstream_timeout_seconds
        )
        self.breaker = CircuitBreaker(
            failure_threshold=self.settings.breaker_failure_threshold,
            cooldown_seconds=self.settings.breaker_cooldown_seconds,
            clock=clock,
        )
        self._last_success_lock = RLock()
        self._last_success_at: str | None = None

    def _run_provider(self, request: Mapping[str, Any]) -> Any:
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tvscreener-upstream")
        future = executor.submit(_call_provider, self.provider, request)
        timed_out = False
        try:
            return future.result(timeout=self.settings.upstream_timeout_seconds)
        except FutureTimeoutError as exc:
            timed_out = True
            future.cancel()
            raise UpstreamUnavailableError from exc
        finally:
            executor.shutdown(wait=not timed_out, cancel_futures=True)

    def screen(self, payload: Any) -> dict[str, Any]:
        request = validate_request(payload)
        if not self.breaker.allow_request():
            raise CircuitOpenError

        try:
            frame = self._run_provider(request)
            rows, warnings = normalize_frame(frame, request)
        except Exception as exc:
            self.breaker.record_failure()
            raise UpstreamUnavailableError from exc

        self.breaker.record_success()
        fetched_at = _utc_now()
        with self._last_success_lock:
            self._last_success_at = fetched_at
        has_row_warnings = any(row.get("warnings") for row in rows)
        return {
            "source": "tradingview-screener",
            "requestId": str(uuid.uuid4()),
            "fetchedAt": fetched_at,
            "coverage": "partial" if warnings or has_row_warnings else "live",
            "rows": rows,
            "warnings": warnings,
        }

    def healthz(self) -> dict[str, Any]:
        with self._last_success_lock:
            last_success_at = self._last_success_at
        return {
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "tvscreenerVersion": TVSCREENER_VERSION,
            "lastSuccessAt": last_success_at,
            "breaker": self.breaker.snapshot(),
        }


class TvScreenerProvider:
    """Build only the fixed CryptoScreener query allowed by the wire contract."""

    def __init__(self, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        self._lock = RLock()

    @staticmethod
    def _find_field(field_type: Any, protocol_field: str) -> Any | None:
        for attribute in FIELD_ATTR_CANDIDATES[protocol_field]:
            field = getattr(field_type, attribute, None)
            if field is not None:
                return field
        return None

    @staticmethod
    def _append_unique(fields: list[Any], field: Any) -> None:
        field_name = getattr(field, "field_name", None)
        if field_name is None:
            field_name = repr(field)
        if not any(getattr(existing, "field_name", repr(existing)) == field_name for existing in fields):
            fields.append(field)

    def __call__(self, request: Mapping[str, Any]) -> Any:
        with self._lock:
            import tvscreener
            from tvscreener import CryptoField, CryptoScreener

            # tvscreener 0.4.0 uses this module-level value for requests.post.
            # Keep the sidecar's deadline at ten seconds without changing the
            # public request contract or passing arbitrary caller data through.
            try:
                from tvscreener.core import base as tv_base
            except ImportError:
                tv_base = None

            previous_timeout = getattr(tv_base, "REQUEST_TIMEOUT", None) if tv_base else None
            if tv_base is not None:
                tv_base.REQUEST_TIMEOUT = self.timeout_seconds

            try:
                screener = CryptoScreener()
                screener.symbols = {
                    "query": {"types": []},
                    "tickers": list(request["symbols"]),
                }

                selected_fields: list[Any] = []
                for protocol_field in request["fields"]:
                    base_field = self._find_field(CryptoField, protocol_field)
                    if base_field is None:
                        continue
                    self._append_unique(selected_fields, base_field)
                    with_interval = getattr(base_field, "with_interval", None)
                    if not callable(with_interval):
                        continue
                    for interval in request["intervals"]:
                        try:
                            interval_field = with_interval(interval)
                            # tvscreener 0.4.0's FieldWithInterval omits the
                            # method used by get_columns_to_request(). Keep
                            # the package's interval wrapper, while supplying
                            # the inherited recommendation predicate locally.
                            if not callable(getattr(interval_field, "has_recommendation", None)):
                                interval_field.has_recommendation = base_field.has_recommendation
                            self._append_unique(selected_fields, interval_field)
                        except (TypeError, ValueError):
                            continue

                # These identity fields are fixed metadata needed by the wire
                # row shape; they are not caller-controlled query fields.
                for attribute in ("NAME", "EXCHANGE"):
                    metadata_field = getattr(CryptoField, attribute, None)
                    if metadata_field is not None:
                        self._append_unique(selected_fields, metadata_field)

                if not selected_fields:
                    raise RuntimeError("no supported CryptoScreener fields available")
                screener.select(*selected_fields)

                sort_field = self._find_field(CryptoField, request["sortBy"])
                if sort_field is not None:
                    screener.sort_by(sort_field, ascending=False)
                screener.set_range(0, request["limit"])
                return screener.get()
            finally:
                if tv_base is not None and previous_timeout is not None:
                    tv_base.REQUEST_TIMEOUT = previous_timeout


class _RequestHandler(BaseHTTPRequestHandler):
    server: "SidecarHTTPServer"
    server_version = SERVICE_NAME
    sys_version = ""

    def log_message(self, _format: str, *_args: Any) -> None:
        # Never log request headers, bodies, query data, or upstream exceptions.
        return

    def _send_json(self, status: int, payload: Mapping[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _method_not_allowed(self) -> None:
        self._send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method not allowed"})

    def _read_json(self) -> Any:
        content_length = self.headers.get("Content-Length")
        try:
            length = int(content_length) if content_length is not None else -1
        except ValueError as exc:
            raise RequestValidationError("invalid request body") from exc
        if length < 0 or length > 256 * 1024:
            raise RequestValidationError("invalid request body")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RequestValidationError("invalid request body") from exc

    def do_GET(self) -> None:
        if self.path != "/healthz":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self._send_json(HTTPStatus.OK, self.server.service.healthz())

    def do_POST(self) -> None:
        if self.path != "/v1/screen":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            payload = self._read_json()
            response = self.server.service.screen(payload)
        except RequestValidationError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid request schema"})
            return
        except CircuitOpenError:
            self._send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "error": "sidecar circuit open",
                    "coverage": "unavailable",
                    "rows": [],
                    "warnings": ["TradingView upstream circuit open"],
                },
            )
            return
        except UpstreamUnavailableError:
            self._send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "error": "upstream unavailable",
                    "coverage": "unavailable",
                    "rows": [],
                    "warnings": ["TradingView upstream unavailable"],
                },
            )
            return
        except Exception:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "sidecar request failed"},
            )
            return
        self._send_json(HTTPStatus.OK, response)

    def do_HEAD(self) -> None:
        self._method_not_allowed()

    def do_OPTIONS(self) -> None:
        self._method_not_allowed()

    def do_PUT(self) -> None:
        self._method_not_allowed()

    def do_PATCH(self) -> None:
        self._method_not_allowed()

    def do_DELETE(self) -> None:
        self._method_not_allowed()


class SidecarHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address: tuple[str, int], service: SidecarService) -> None:
        self.service = service
        super().__init__(server_address, _RequestHandler)


def create_server(service: SidecarService | None = None, settings: Settings | None = None) -> SidecarHTTPServer:
    """Create a server bound to the numeric IPv4 loopback address only."""

    if service is None:
        service = SidecarService(settings=settings)
    effective_settings = settings or service.settings
    if effective_settings.host != LOOPBACK_HOST:
        raise ValueError("sidecar must bind to 127.0.0.1")
    return SidecarHTTPServer((LOOPBACK_HOST, effective_settings.port), service)


def main() -> None:
    settings = Settings.from_env()
    server = create_server(settings=settings)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
