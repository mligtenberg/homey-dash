# DeviceTile

A tile for one device. A toggleable device gets a power button in the top right corner, and its state shows in the fill and the detail line.

The consumer provides the device's kind, name and current state. When the power button is pressed, it sends the toggle to HomeyDash and updates `.is-active` and the detail line when Homey reports the new state, not before.

- On: `.is-active`, with a detail line such as `On · 80%`.
- Off: no class, with the detail line `Off`.
- Locks use `security`. Unlocked is `.is-active`. A lock with a `locked` control gets the corner button, labeled `Lock` or `Unlock`; unlocking needs a second press within 3 seconds, labeled `Confirm unlock`, while the detail line reads `Tap again`. See [State](../State.md).
- The power button is an `.hd-round-btn.hd-tile__action`, white while on and grey while off (see [State](../State.md)), smaller than the inline controls so it fits a small tile, with a Lucide `power` icon, labeled `Turn on` or `Turn off`, in an `.hd-row.hd-row--top` with the tile's icon. It is disabled while the device is unavailable.
- A speaker (any device with `speaker_playing`) without a power button gets a play/pause button in its place, with a Lucide `play` or `pause` icon, labeled `Play` or `Pause`. While it plays, its detail line says what plays (`Track · Artist`), and the tile shows Homey's album art behind it as `.has-art` with the picture in `--art`, darkened so the white text and the white button read. Paused, its detail line says `Not playing` and the art goes away.
- A speaker with a volume (`volume_set`) on a tile that is not small also gets a volume slider, `.hd-tile__volume`, with a `Volume` label and the same thin slider as the Sonos tile. Over album art it is white. A small tile leaves it to the detail view.
- A small tile with a reading (a sensor, a thermostat) shows it as `.hd-value--m` in place of the icon. There is no room for both.
- A tap anywhere else opens the full-screen [TileDetails](TileDetails.md), laid out for the kind of device, with every control the device has, but only when they show more than the tile: a control it has no room for, another reading, or why the device is unavailable. A plain plug or a single-reading sensor has no details.
