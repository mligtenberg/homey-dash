# DeviceTile

A tile for one device. A toggleable device gets a power button in the top right corner, and its state shows in the fill and the detail line.

The consumer provides the device's kind, name and current state. When the power button is pressed, it sends the toggle to HomeyDash and updates `.is-active` and the detail line when Homey reports the new state, not before.

- On: `.is-active`, with a detail line such as `On · 80%`.
- Off: no class, with the detail line `Off`.
- Locks use `security`. "Locked" is the active state.
- The power button is an `.hd-round-btn.hd-tile__action`, smaller than the inline controls so it fits a small tile, with a Lucide `power` icon, labeled `Turn on` or `Turn off`, in an `.hd-row.hd-row--top` with the tile's icon. It is disabled while the device is unavailable.
- A small tile with a reading (a sensor, a thermostat) shows it as `.hd-value--m` in place of the icon. There is no room for both.
- A tap anywhere else opens the [TileDetails](TileDetails.md) with every control the device has, but only when they show more than the tile: a control it has no room for, another reading, or why the device is unavailable. A plain plug or a single-reading sensor has no details.
