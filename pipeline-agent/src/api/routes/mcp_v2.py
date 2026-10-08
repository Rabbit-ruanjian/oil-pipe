"""MCP diagnostic endpoints for v2 API."""

from __future__ import annotations

from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from src.mcp import get_mcp_hub

router = APIRouter(prefix="/mcp", tags=["mcp-v2"])


@router.get("/servers")
async def list_mcp_servers():
    hub = get_mcp_hub()
    servers = []
    for name in hub.server_names():
        tools = await hub.list_tools(name)
        resources = await hub.list_resources(name)
        servers.append(
            {
                "name": name,
                "tool_count": len(tools),
                "resource_count": len(resources),
            }
        )
    return {"servers": servers, "count": len(servers)}


@router.get("/tools")
async def list_mcp_tools(server: Optional[str] = Query(default=None)):
    hub = get_mcp_hub()
    if server and not hub.has_server(server):
        raise HTTPException(status_code=404, detail=f"server not found: {server}")

    tools = await hub.list_tools(server)
    return {
        "server": server,
        "tools": [asdict(tool) for tool in tools],
        "count": len(tools),
    }


@router.get("/resources")
async def list_mcp_resources(server: Optional[str] = Query(default=None)):
    hub = get_mcp_hub()
    if server and not hub.has_server(server):
        raise HTTPException(status_code=404, detail=f"server not found: {server}")

    resources = await hub.list_resources(server)
    return {
        "server": server,
        "resources": [asdict(resource) for resource in resources],
        "count": len(resources),
    }


@router.get("/resource")
async def read_mcp_resource(
    server: str = Query(..., description="MCP server name"),
    uri: str = Query(..., description="resource URI"),
    max_len: int = Query(default=20000, ge=0, le=200000),
):
    hub = get_mcp_hub()
    if not hub.has_server(server):
        raise HTTPException(status_code=404, detail=f"server not found: {server}")

    try:
        content = await hub.read_resource(server, uri)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    truncated = False
    if max_len > 0 and len(content) > max_len:
        content = content[:max_len]
        truncated = True

    return {
        "server": server,
        "uri": uri,
        "content": content,
        "truncated": truncated,
        "content_length": len(content),
    }

