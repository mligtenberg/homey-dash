# AI assistants configure HomeyDash through an MCP server

The backend serves an MCP server at `/mcp`, so an AI assistant can build dashboards, publish them and assign them to displays. Its tools do the same things as the matching Management endpoints, with the same rules, and they notify screens and Management the same way. An open Management window therefore shows an assistant's changes at once. The tools cannot delete dashboards or displays, so an assistant cannot remove anything by mistake; that stays a Management action.

## Considered Options

- **Let assistants call the REST API directly.** Rejected: the API is shaped for Management. An assistant would have to learn the layout rules, tile kinds and targets from the source code instead of from tool descriptions.
- **A separate MCP process that calls the REST API.** Rejected: one more thing to deploy, and it adds nothing an in-process server doesn't already do.

## Consequences

- Management is no longer the only place configuration changes. It is still the only place where a dashboard is arranged visually and where things are deleted.
- The backend does not know the tile kinds; each module declares its own ([ADR-0003](0003-tile-kinds-are-code-modules.md)). So the `save_draft` tool description repeats each kind's sizes, target and settings from `CORE_TILES`. Adding or changing a tile kind means updating that description too.
- Like every endpoint, `/mcp` has no authentication ([ADR-0001](0001-trust-the-home-network.md)). It is reachable wherever the backend is, not only on Management's port ([ADR-0004](0004-management-as-separate-app.md)), so restricting access by port has to cover it too.
