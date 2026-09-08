"""Configuration for the loopback-only TradingView screener sidecar."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


SERVICE_NAME = "tvscreener-sidecar"
SERVICE_VERSION = "1.0.0"
TVSCREENER_VERSION = "0.4.0"

LOOPBACK_HOST = "127.0.0.1"
DEFAULT_PORT = 8791
UPSTREAM_TIMEOUT_SECONDS = 10.0
BREAKER_FAILURE_THRESHOLD = 3
BREAKER_COOLDOWN_SECONDS = 30.0


class ConfigError(ValueError):
    """Raised when a sidecar setting would violate the local-only boundary."""


@dataclass(frozen=True, slots=True)
class Settings:
    """Validated runtime settings.

    Port zero is accepted for in-process tests; the normal default remains 8791.
    The host is intentionally not configurable away from the IPv4 loopback
    literal so a typo cannot expose this service on a network interface.
    """

    host: str = LOOPBACK_HOST
    port: int = DEFAULT_PORT
    upstream_timeout_seconds: float = UPSTREAM_TIMEOUT_SECONDS
    breaker_failure_threshold: int = BREAKER_FAILURE_THRESHOLD
    breaker_cooldown_seconds: float = BREAKER_COOLDOWN_SECONDS

    def __post_init__(self) -> None:
        if self.host != LOOPBACK_HOST:
            raise ConfigError("TVSCREENER_HOST must be 127.0.0.1")
        if isinstance(self.port, bool) or not isinstance(self.port, int) or not 0 <= self.port <= 65535:
            raise ConfigError("TVSCREENER_PORT must be an integer from 0 to 65535")
        if self.upstream_timeout_seconds <= 0:
            raise ConfigError("upstream timeout must be positive")
        if self.breaker_failure_threshold < 1:
            raise ConfigError("breaker failure threshold must be positive")
        if self.breaker_cooldown_seconds <= 0:
            raise ConfigError("breaker cooldown must be positive")

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Settings":
        """Read only the non-secret sidecar host and port settings."""

        env = os.environ if environ is None else environ
        host = env.get("TVSCREENER_HOST", LOOPBACK_HOST).strip() or LOOPBACK_HOST
        port_value = env.get("TVSCREENER_PORT", str(DEFAULT_PORT)).strip()
        try:
            port = int(port_value)
        except (TypeError, ValueError) as exc:
            raise ConfigError("TVSCREENER_PORT must be an integer") from exc
        return cls(host=host, port=port)


DEFAULT_SETTINGS = Settings()
