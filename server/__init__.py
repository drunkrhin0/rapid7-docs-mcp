"""Rapid7 Docs MCP Server — FastMCP edition."""

__version__ = "2.0.0"

from .mcp_server import main, mcp  # noqa: F401

__all__ = ["mcp", "main", "__version__"]
