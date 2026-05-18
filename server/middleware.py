"""Rate limiting middleware for FastMCP server.

Configurable per-API-key token bucket. Configure via:
  MCP_RATE_LIMIT=60   (default: requests per minute per key)
"""

import os
import time
from collections import defaultdict
from typing import Any

from fastmcp.server.middleware import CallNext, Middleware, MiddlewareContext


class RateLimitMiddleware(Middleware):
    """Token-bucket rate limiter per API key."""

    def __init__(self, rpm: int | None = None) -> None:
        if rpm is None:
            rpm = int(os.environ.get("MCP_RATE_LIMIT", "60"))
        self.rpm = rpm
        self.interval = 60.0 / rpm  # seconds between allowed requests
        self._buckets: dict[str, float] = defaultdict(float)

    def _is_ok(self, key: str) -> bool:
        now = time.monotonic()
        last = self._buckets.get(key, 0.0)
        if now - last >= self.interval:
            self._buckets[key] = now
            return True
        return False

    async def on_call_tool(
        self, context: MiddlewareContext, call_next: CallNext
    ) -> Any:
        # Extract API key from metadata if available
        meta = getattr(context.message, "meta", None) or {}
        api_key = meta.get("api_key", "anonymous")
        if not self._is_ok(api_key):
            from fastmcp.exceptions import ToolError
            raise ToolError("Rate limit exceeded. Retry shortly.")
        return await call_next(context)
