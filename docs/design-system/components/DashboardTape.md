# DashboardTape

Pills floating over the left edge of a display that offers more than one dashboard, for switching between them.

- Use `<nav class="hd-tape" aria-label="Dashboards">` inside the display root, over the dashboard. The dashboard keeps the full width. Start with a `.hd-tape__toggle` button, then add one `.hd-tape__item` pill per dashboard, with the main dashboard first and the others in the order Management lists them. The one on screen has `aria-current="page"`. The toggle and the pills show a [Ripple](Ripple.md) when pressed.
- Keep the tape quiet: the pills are frosted (`panel` at 72% with a blur) with muted text. Only the current pill is solid. The pills sit in a column centred on the toggle.
- The tape starts collapsed to just the toggle (a layers icon, `aria-expanded="false"`), centred on the left edge. Opening it (the icon becomes a chevron) floats each pill out of the toggle in 0.2s: it leaves as a circle and stretches into its pill beside the toggle. The toggle stays where it is. Put the pills in a `.hd-tape__pills` column with `--n` set to their count and `--i` to each pill's index. Closing plays this backwards in 0.1s: the pills shrink to circles and float back into the toggle. Put `animate.leave="is-leaving"` on the `.hd-tape__pills` column so it stays until they are in. With reduced motion the pills just appear and disappear. Picking a dashboard collapses the tape again. The screen remembers an opened tape in localStorage (`homeydash.tape`), so it stays open after a reload.
- Leave the tape out when a display offers only one dashboard.
- Pills are at least 44px tall, and names wrap instead of being cut off.
- The tape keeps working during [ConnectionLost](ConnectionLost.md), because switching dashboards doesn't need Homey.
- After a minute without a touch, the display goes back to its main dashboard. Switching dashboards starts the new one at its first page.

Don't put anything else on the tape, such as a clock or settings. It only switches dashboards.
