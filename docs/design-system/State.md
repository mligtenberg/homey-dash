# State

How a display tile says what it is and what state it is in. Two separate channels, so a tile can be read for either.

- **Type is the hue.** The tile's kind (`data-kind`) picks one hue, and it never changes with state. A lamp is amber off or on.
- **State is intensity, and the marks on the tile.** How strong the tile's colour is says whether it is on. Elements on the tile (the quick action, the detail line) repeat it in neutral colour, never in a hue.

## Intensity

Three steps, all of the tile's own hue:

| Step | Looks like | Means |
|---|---|---|
| Rest | `kind-*-fill` at 22% over `tile-surface` | Off, closed, idle, or nothing to report |
| Active (`.is-active`) | The full `kind-*-fill`, text in `ink` | On, running, playing, open or in motion |
| Unavailable (`.is-unavailable`) | The rest or active look at 60% opacity, with a badge | Homey can't reach it; the last known state, dimmed |

Missing is not a state of the device, see [TileStates](components/TileStates.md).

Active means the thing is doing something or is exposed: a light is on, a door is open, motion is seen, a speaker plays. It never means "fine" or "secure". Don't invent a fourth step; a level such as 80% brightness belongs in the detail line or a slider, not in the fill.

## State mark

The one control on a tile that holds a state is its power or play button, in the top right corner (`.hd-tile__action`). It wears state in neutral colour so it never competes with the hue:

- On: white (`--state-on-bg`) with dark ink (`--state-on-ink`), the same in both themes.
- Off: grey (`--state-off-bg`, 12% of `ink`) with `ink-muted` glyph.
- Unavailable: disabled at 50%.

A button that runs something rather than switching it (a flow, a mood: `.hd-tile__action--run`) has no state, so it keeps the kind's ink. White therefore always means on, and nothing else on a tile is white-on-fill.

## Locks

A lock is a switch whose "on" is unlocked, the exposed state. It keeps its type hue and gets the same corner button as any switch: grey while locked, white while unlocked (the tile is active while unlocked). The button's glyph shows what a press does, an open lock to unlock and a closed one to lock.

Locking takes one press. Unlocking takes two, so a stray touch can't open the door: the first press turns the button solid ink and the detail line reads `Tap again`; a second press within 3 seconds unlocks, and otherwise it lapses.

## By situation

| Situation | Examples | Intensity | Mark | Detail line |
|---|---|---|---|---|
| Switch | Light, plug, appliance, vacuum | Rest or active | Power button, white or grey | `On · 80%`, `Off` |
| Playback | Speaker, Apple TV | Active while it plays | Play or pause button, white while playing | What plays, or `Not playing` |
| Read-only status | Door, contact, motion | Active when open, in motion | None: it has nothing to press | `Open`, `Closed`, `No motion` |
| Lock | Door lock | Rest when locked; active when unlocked | Lock button, grey or white; unlocking asks twice | `Locked`, `Unlocked` |
| Reading | Temperature, humidity, power | Rest | None | The reading is the headline |
| Setpoint | Thermostat | Rest | The stepper | `Set to 20°C` |
| Position | Curtain, blind | Active while open | The segmented control | `40% open`, `Closed` |
| Run | Flow, mood | None: no state | Run button in the kind's ink | The kind: `Flow`, `Mood` |
| Content | Photo, Plex, traffic | None | Their own controls | Their own |

Over album art or a poster the tile is dark by its own rules; its button follows the same on/off marks.

## Don't

- Don't recolour the tile for state; only its intensity changes. State colour goes on elements, and those are neutral.
- Don't show state by changing the icon's colour. The fill carries it.
- Don't use red or green on a tile for on/off. Status colours (`ok`, `warn`, `danger`) are for problems, not state.

## Open decisions

- **Read-only tiles** show state only by intensity and the detail line. If that proves too quiet from across the room, give them a passive disc in the corner (same white or grey, no press feedback) rather than a new colour.
