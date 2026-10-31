# ConnectionLost

The display state when it can't reach HomeyDash, or HomeyDash can't reach a Homey the dashboard has tiles of.

- When HomeyDash can't be reached, add `.is-connection-lost` to the `.hd-display` root. Every tile desaturates and stops responding to taps. Horizontal scrolling keeps working.
- When HomeyDash can't reach a Homey (or no Homey is set up), the `.hd-tile-host` of each tile on that Homey gets `.is-homey-lost`. Only those tiles desaturate and stop responding; the rest keep working.
- In either case, show one `.hd-reconnecting` pill, fixed at the bottom center. Add the bottom safe-area inset to its offset. A lost Homey the shown dashboard has no tiles of shows no pill.
- Keep showing the last known values. Recovery happens on its own: remove the class, and if a newer version of the dashboard was published meanwhile, load it.

Don't show a full-screen error or a dialog, and don't ask the user to do anything.
