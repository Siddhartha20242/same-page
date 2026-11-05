# Using Same Page from an MCP client

Same Page ships a `rovo:mcp` module, so an MCP client such as Claude Code or Cursor can ask it to check a work item against its linked pages.

## Turn it on (site admin, once)
Atlassian Administration > Apps > Sites > your site > Connected apps > Same Page: allow external access. It is off by default.

## Connect Claude Code
```bash
claude mcp add --transport http same-page https://mcp.atlassian.com/forge/bfaa94fa-5d7a-44a3-b41f-1cd0aa6cc462
```
Then run `/mcp` in Claude Code, pick `same-page`, and sign in. Atlassian shows an OAuth consent screen; tools are available after you accept.

## Check the endpoint without signing in
```bash
curl -i -X POST https://mcp.atlassian.com/forge/bfaa94fa-5d7a-44a3-b41f-1cd0aa6cc462 \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
```
A live endpoint answers `401` with a `www-authenticate` header pointing at its OAuth metadata. This was observed on 2026-11-05.

## Status
The endpoint is live. A signed-in tool call from a third-party client has not been recorded yet.
