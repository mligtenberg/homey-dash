# ConnectionLost

The display state when it can't reach HomeyDash, or HomeyDash can't reach Homey.

- Add `.is-connection-lost` to the `.hd-display` root. Tiles desaturate and stop responding to taps. Horizontal scrolling keeps working.
- Show one `.hd-reconnecting` pill, fixed at the bottom center. Add the bottom safe-area inset to its offset.
- Keep showing the last known values. Recovery happens on its own: remove the class, and if a newer version of the dashboard was published meanwhile, load it.

Don't show a full-screen error or a dialog, and don't ask the user to do anything.
