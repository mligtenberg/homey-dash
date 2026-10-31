---
title: Logic tile and rule engine
status: ready-for-agent
date: 2026-10-31
adr: docs/adr/0010-rules-evaluated-by-homeydash-on-subscription.md
---

# Logic tile and rule engine

## Problem Statement

A dashboard is fixed: every tile always shows the same thing, whatever is happening in the home. Space on a wall screen is scarce, yet much of what deserves it only matters some of the time. The doorbell camera matters while someone is at the door, the thermostat when the room is cold, Now playing while Plex plays, a holiday photo set in December. Today the only way to get these is to give each its own permanent tile, or to build several dashboards and switch between them by hand. Nothing lets the dashboard itself change with the state of the home, the time, or the display it is on.

## Solution

A new tile kind, the **Logic tile**, holds an ordered list of tiles of any other kind, each guarded by a **Rule**, plus an optional fallback tile. It shows the first tile whose rule holds, or the fallback when none does, or nothing (like empty cells) when there is no fallback. It fades from one tile to the next. It can keep a tile on screen for a **Minimum show time** so it never flickers.

Rules are built, as in Homey Logic, from **Conditions** on typed **Signals**. A signal is a live value of one of four types: text, yes/no, number, or date and time. Signals come from:

- Homey device capabilities and Homey variables, of any Homey account
- the clock
- the display the dashboard is shown on: its name and when it was last touched
- Plex

A rule combines its conditions with *all of* or *any of*.

HomeyDash, not the display, evaluates rules. While a dashboard is shown, each logic tile subscribes to its rules and HomeyDash pushes each answer as it changes ([ADR-0010](../adr/0010-rules-evaluated-by-homeydash-on-subscription.md)). The same engine powers the Preview and the Editor in Management through an API endpoint, and AI assistants can build logic tiles over MCP.

## User Stories

### Showing a logic tile on a display

1. As someone in the home, I want a tile to show something different depending on the state of the home, so that the dashboard shows what matters right now.
2. As someone in the home, I want the logic tile to show the first of its tiles whose rule holds, so that I can predict what it shows from the order of its tiles.
3. As someone in the home, I want the logic tile to show its fallback tile when no rule holds, so that it always shows something sensible.
4. As someone in the home, I want a logic tile without a fallback to show nothing when no rule holds, so that something like a doorbell camera only appears when it is relevant.
5. As someone in the home, I want the logic tile to fade from one tile to the next, so that a switch doesn't look like a glitch.
6. As someone in the home, I want the tile a logic tile shows to work exactly like that tile placed on its own (its tap action, inline controls and detail view), so that I don't have to learn anything new.
7. As someone in the home, I want the logic tile to switch within moments of a change in the home, so that it feels live.
8. As someone in the home, I want a logic tile to keep a tile on screen for its minimum show time, so that it doesn't flicker when a value hovers around a threshold.
9. As someone in the home, I want a logic tile to show what its rules choose at the moment its minimum show time runs out, so that it never replays changes it skipped.
10. As someone in the home, I want a logic tile to keep showing its last chosen tile during **Connection lost**, so that the dashboard stays useful with its last known state, like every other tile.
11. As someone in the home, I want a logic tile to catch up as soon as the display reconnects, so that I never see an outdated choice for long.
12. As someone in the home, I want a chosen tile that points at a missing target to show its usual **Missing** state, so that a broken tile is visible and not silently skipped.

### Signals

13. As a dashboard builder, I want to use a device capability as a signal (on, temperature, motion, contact, dim level and so on), so that a tile can react to any device.
14. As a dashboard builder, I want to use a Homey variable as a signal, so that a tile can follow house modes like Away, Night or Guests.
15. As a dashboard builder, I want to use signals from any of the home's Homey accounts, and mix them in one rule, so that one rule can span two Homeys.
16. As a dashboard builder, I want to use the clock as a date-and-time signal, so that a tile can change by time of day, weekday or date.
17. As a dashboard builder, I want to use the display's name as a signal, so that the same dashboard can behave differently in the kitchen and in the hallway.
18. As a dashboard builder, I want a condition on a display to keep working when that display is renamed, so that renaming never breaks a rule.
19. As a dashboard builder, I want a condition on a display to follow its identity through a **Takeover**, so that a replacement screen behaves like the one it replaced.
20. As a dashboard builder, I want to use when the display was last touched as a signal, so that a tile can show a large clock while no one is using the screen and controls when someone is.
21. As a dashboard builder, I want to use Plex's playback state as a signal, so that a tile can show Now playing while something plays and photos otherwise.
22. As a dashboard builder, I want date-and-time device values (such as when motion was last seen) to be signals too, so that I can ask how long ago something happened.
23. As a module author, I want my module to be able to add its own signals, so that new integrations can feed logic without changing the engine.

### Conditions and rules

24. As a dashboard builder, I want each condition to offer only the operators that suit its signal's type, so that I can't write a nonsensical comparison.
25. As a dashboard builder, I want number conditions (equals, greater than, less than, between), so that I can react to thresholds.
26. As a dashboard builder, I want yes/no conditions (is true, is false), so that I can react to on/off and open/closed.
27. As a dashboard builder, I want text conditions (equals, contains, starts with, is empty), so that I can react to modes and names.
28. As a dashboard builder, I want date-and-time conditions: time of day between (also across midnight), on chosen weekdays, within the last N, longer ago than N, date between two days of the year, and before or after a fixed moment, so that I can describe recurring times and how long ago something happened.
29. As a dashboard builder, I want time-based conditions to work down to the second, so that "motion within the last 30 seconds" does what it says.
30. As a dashboard builder, I want to negate any condition, so that I can say "not" without needing an opposite operator.
31. As a dashboard builder, I want to combine conditions with *all of* or *any of*, so that I can say "TV on and after 19:00".
32. As a dashboard builder, I want text signals with a fixed set of values (such as a thermostat's modes) to offer those values in a dropdown, so that I can't misspell them.
33. As a dashboard builder, I want number signals to show their unit and range, so that I know what "18" means.
34. As a dashboard builder, I want yes/no signals to show their own labels (open/closed rather than true/false), so that conditions read naturally.
35. As a dashboard builder, I want a condition on an **Unavailable** signal to use its last known value, so that a sensor dropping out briefly doesn't flip the tile.
36. As a dashboard builder, I want a condition on a **Missing** signal, or on one that has never had a value, to fail even when negated, so that the logic tile moves on to its next tile and never picks one at random.
37. As a dashboard builder, I want removing a Homey account to make its signals **Missing**, and an unreachable Homey to make them **Unavailable**, so that signals behave like tiles.

### Building in Management

38. As a dashboard builder, I want to add a logic tile in the Editor like any other tile kind, so that it fits how I already build dashboards.
39. As a dashboard builder, I want to add, reorder and remove the tiles a logic tile holds, each with its own rule, so that I control which wins.
40. As a dashboard builder, I want to configure each tile a logic tile holds exactly as I would configure it on its own, so that nothing new needs learning.
41. As a dashboard builder, I want the tiles a logic tile holds to take its size, and only kinds that support that size to be offered, so that every tile it holds fits.
42. As a dashboard builder, I want to be stopped from putting a logic tile inside another logic tile, so that rules stay a flat, readable list.
43. As a dashboard builder, I want to set an optional fallback tile, so that I decide whether "none matches" shows something or nothing.
44. As a dashboard builder, I want to set a minimum show time, off by default, so that I can calm down a logic tile that flickers.
45. As a dashboard builder, I want to pick a signal by its source (account, device and capability, or variable, clock, display, Plex), so that I can find it among hundreds.
46. As a dashboard builder, I want the Editor to show what the logic tile's rules choose right now, so that I see what the wall would show.
47. As a dashboard builder, I want the Editor to show the tile I am configuring while I configure it, even when its rule doesn't hold, so that I can see what I'm changing.
48. As a dashboard builder, I want a badge on a logic tile in the Editor saying which of its tiles is showing ("2 of 3", "fallback", "nothing"), so that I never mistake it for a plain tile.
49. As a dashboard builder, I want an unconfigured logic tile to show an empty state with a hint in the Editor, so that I know it needs rules.
50. As a dashboard builder, I want to choose which display the Preview and the Editor pretend to be on, or none, so that I can check rules on display signals.
51. As a dashboard builder, I want the Preview to always show the live choice, so that it is a faithful rendering of the draft.
52. As a dashboard builder, I want Management to flag every dashboard with a condition on a **Missing** signal, so that I can repair it, the same way it flags missing targets.
53. As a dashboard builder, I want Management to warn about a condition comparing with a value no longer among its signal's allowed values, so that I notice when a firmware update changed a device's modes.
54. As a dashboard builder, I want invalid rules (unknown signal, wrong operator for a type, wrong value type) to be rejected when I save the draft, with a clear message, so that a broken rule never reaches a display.

### AI assistants

55. As someone using an AI assistant, I want it to list the available signals with their account, type and allowed values, so that it can write rules.
56. As someone using an AI assistant, I want it to build and edit logic tiles in a draft, so that it can make dashboards that change with the home.
57. As someone using an AI assistant, I want it to keep a dashboard's existing logic tiles intact when it changes other parts of the draft, so that it never mangles them.
58. As someone using an AI assistant, I want invalid rules it writes to be rejected with a message it can act on, so that it can correct itself.

## Implementation Decisions

### Rule engine (backend)

- A new backend module, the rule engine, knows **Signals**, **Conditions** and **Rules**, and nothing about tile kinds. The backend owns the rule schema; it still does not know tile kinds ([ADR-0003](../adr/0003-tile-kinds-are-code-modules.md), [ADR-0010](../adr/0010-rules-evaluated-by-homeydash-on-subscription.md)).
- Value types: text, yes/no, number (float), date and time. There is no fifth type: an enum is text with allowed values.
- A signal has a stable id, its source, its type, a display name, and optional editor-only metadata: allowed values (text), unit/min/max/step (number), true/false labels (yes/no). Homey signals include the Homey account they belong to.
- Signals are registered by **signal sources** behind one interface, so a module can add its own. Initial sources:
  - Homey device capabilities, per account. Homey's capability types map to the four value types, and enum capabilities become text with allowed values.
  - Homey variables, per account. This is new: HomeyDash does not read Homey variables today. It needs to read them, follow their changes, and handle them in FakeHomey.
  - The clock: `now`, as a date and time.
  - The display: its name (stored by permanent identity, shown by current name, with the displays as allowed values) and when it was last touched.
  - Plex: playback state per player, as text with allowed values.
- Operators per type:
  - number: equals, greater than, less than, between
  - yes/no: is true, is false
  - text: equals, contains, starts with, is empty
  - date and time: time of day between (may wrap midnight), on weekdays (a set), within the last N (seconds/minutes/hours/days), longer ago than N, date between (day-month to day-month, every year), before, after
  - Any condition can be negated.
- A condition compares a signal with a **fixed value** only, never with another signal.
- A rule is one or more conditions combined with *all of* or *any of*, one level deep, with no nesting.
- Evaluation:
  - **Unavailable** signals use their last known value.
  - A **Missing** signal, or one that has never had a value, makes its condition fail regardless of negation.
  - A comparison with a value no longer among the allowed values simply never holds.
- Time-based conditions are re-checked at the exact moment their answer would next flip (seconds precision), computed from the injected time provider. There is no fixed tick.

### Subscriptions over the realtime connection

- New realtime hub methods let a connection subscribe to a rule (sending the rule itself) and unsubscribe from it. The connection's display identity is known from joining as a screen. Management connections subscribe with an optional "as display".
- The answer is yes or no per rule. Answers changed by one signal change are sent in **one batched message**, so a tile never sees an in-between set.
- Subscribing returns the current answer at once. Disconnecting drops all of a connection's subscriptions. After reconnecting, the client subscribes again.
- The display reports touches to HomeyDash so the "last touched" signal can be evaluated, throttled so a continuous touch doesn't flood the connection.

### Preview endpoint

- A new API endpoint evaluates a set of rules once, optionally as a given display, and returns their answers. Management's Editor and Preview use it, or the subscription with "as display", for live updates. Both go through the same engine.

### Signal catalogue

- A new API endpoint lists the available signals with their source, account, type and metadata. Management's signal picker and the MCP server use it. It mirrors how targets are listed today.

### Logic tile kind (frontend)

- A new tile kind `logic` in a tile module. Its settings contain:
  - an ordered list of entries, each a complete nested tile (kind + target + kind's own settings) plus its rule
  - an optional fallback nested tile
  - a minimum show time (default none)
- Nested tiles take the logic tile's size. Only kinds that support that size can be nested, and `logic` itself can't.
- The tile component subscribes to each entry's rule, picks the first that holds (else the fallback, else empty), applies the minimum show time and the fade, and renders the chosen nested tile through the existing tile host. Interaction, detail views, Unavailable and Missing behave exactly as for that nested tile.
- In the Editor, the logic tile shows the live choice, except while one of its entries is open in the tile panel, which it then shows instead. An overlay badge shows which entry is showing. Its settings panel edits the entry list, rules, fallback and minimum show time, reusing each nested kind's own settings component.

### Dashboard storage and validation

- No schema change to dashboards: the logic tile's nested tiles and rules live in its settings, like any kind's settings.
- Saving a draft validates the rules in logic tiles against the engine's rule schema and rejects invalid ones with a clear message. This is a bounded exception where the backend looks into one kind's settings, only to validate the backend-owned rule schema. Nested tiles stay opaque.
- Management's "missing" flagging is extended to conditions on Missing signals and to nested tiles with missing targets. Conditions on values no longer allowed get a warning.

### MCP server

- New tool `list_signals`.
- The `save_draft` description documents the logic tile's settings and the rule schema. Invalid rules are rejected on save with the same validation as the API ([ADR-0006](../adr/0006-mcp-server-for-assistants.md)).

## Testing Decisions

- A good test drives the system through its public surface, the way a display, Management or an assistant does: realtime hub messages, HTTP endpoints, MCP tools, or a rendered tile. It asserts on what they observe. It doesn't test the engine's internal scheduling or data structures.
- **Rule engine, end to end through the realtime hub**: connect as a screen with the API test factory and FakeHomey, subscribe to rules, change device capabilities and variables in FakeHomey, and assert the pushed answers, including batching, Unavailable/Missing behaviour, account removal, display-name rules surviving rename and takeover, and resubscription after reconnect. Prior art: the realtime hub tests.
- **Controllable clock (new seam)**: the test factory replaces the injected time provider with a fake one the tests can advance. Then time of day, weekdays, date ranges, "within the last" / "longer ago than" and seconds precision can be tested deterministically. The time provider is already injected throughout the backend.
- **Preview endpoint, signal catalogue, validation on save**: HTTP-level tests. Prior art: the dashboard API and dashboard validator tests.
- **MCP**: `list_signals`, and `save_draft` accepting valid and rejecting invalid logic tiles. Prior art: the management tools tests.
- **Logic tile**: specs in the tiles library against faked rule answers, covering first match, fallback, empty, minimum show time (including "show the current choice when it expires"), Connection lost keeping the last choice, Editor pinning of the entry being configured, and the badge. Prior art: the tile host and core tiles specs.

## Out of Scope

- Using the engine for anything other than the logic tile, such as hiding or tinting a tile, notifications, or HomeyDash-side automations. The engine is designed for these, but they aren't built here.
- Comparing a signal with another signal.
- Nested *all of* / *any of* groups, and logic tiles inside logic tiles.
- A hold time on individual conditions. The minimum show time on the tile is the only anti-flicker mechanism.
- Signals from other HomeyDash state beyond Plex playback state, such as photo sets.
- Display signals other than name and last touched (such as the dashboard currently shown, or connectivity).

## Further Notes

- The throttling interval for "last touched" reports is still to be decided during implementation. It must stay fine enough for rules like "touched within the last 30 seconds".
- How a module registers its own signal source on the backend mirrors how modules register tile kinds on the frontend. The exact shape is up to implementation.
- New glossary terms are in `CONTEXT.md`: Logic tile, Minimum show time, Signal, Condition, Rule.
