# DeviceTile

A tap-action tile for one device: pressing anywhere toggles it, and its state shows in the fill and the detail line.

The consumer provides the device's kind, name and current state. On tap, it sends the toggle to HomeyDash and updates `.is-active` and the detail line when Homey reports the new state, not before.

- On: `.is-active`, with a detail line such as `On · 80%`.
- Off: no class, with the detail line `Off`.
- Locks use `security`. "Locked" is the active state.
