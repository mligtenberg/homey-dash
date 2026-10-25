# ActionTile

A Flow or Mood tile: one press starts a Homey flow or activates a mood.

- `data-kind="flow"` for flows, `data-kind="mood"` for moods.
- Resting detail line: `Flow` or `Mood`, or a short description such as `Mood · lights off, heating 16°`.
- On press: add `.is-feedback` and change the detail line to `Started` (flow) or `Activated` (mood). After about 1.4 seconds, remove the class and restore the line.
- Flows and moods have no on/off state. Never leave one active.
