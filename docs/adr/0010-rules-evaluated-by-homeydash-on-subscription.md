# HomeyDash evaluates rules for whoever subscribes to them

A logic tile shows the first of its tiles whose rule holds. The rules are not evaluated on the display: when a dashboard is shown, each logic tile sends each of its rules to HomeyDash over the realtime connection and subscribes to its answer, and unsubscribes when the dashboard closes or the connection drops. HomeyDash evaluates the rule against live signals (Homey devices and variables of any Homey account, the clock, the display, Plex) and pushes yes or no whenever the answer changes. The engine knows rules and signals, never tile kinds, so it can serve other uses later without change.

## Considered Options

- **Evaluate rules on the display, with HomeyDash streaming signal values.** Rejected: every display would need every signal it might use, it puts decisions in the display that ADR-0002 keeps thin, and uses with no display at all (notifications, automations) could not share the engine.
- **HomeyDash reads rules out of stored dashboards.** Rejected: the backend would have to parse the logic tile's settings, which breaks [ADR-0003](0003-tile-kinds-are-code-modules.md)'s rule that the backend does not know tile kinds. With subscriptions, the backend owns only the rule schema.
- **One subscription per logic tile that returns the first matching rule.** Rejected: "first match" is the tile's business. Instead, all answers changed by the same signal change arrive in one message, so a tile never sees an in-between set.

## Consequences

- The display applies the logic tile's minimum show time and fade itself; HomeyDash only reports yes or no per rule.
- A display in connection lost keeps its last chosen tile and subscribes again once it reconnects, getting the current answers at once.
- The connection carries the display's identity and when it was last touched, which the display reports, so display signals are evaluated per display. A preview or the Editor asks the same engine through an API endpoint, as if on a display chosen in Management or on none.
- Time-based conditions (seconds precision) are re-checked at the moment their answer would flip, not on a fixed tick.
- Assistants can build logic tiles over MCP ([ADR-0006](0006-mcp-server-for-assistants.md)): `list_signals` lists signals with their account, type and allowed values, the `save_draft` description includes the rule schema, and the engine rejects invalid rules on save.
- Displays use the same subscriptions for their idle rules: left alone, a display does what the first rule that holds says (show one of its dashboards, or play a photo set or fill the screen with a colour until touched), and stays where it is while none does. Its idle rules reach it with its screen view, so the backend still never reads a dashboard's tiles.
