# TargetPicker

Picks a tile's target. It looks like a select and opens a dialog with Homey's zones or flow folders on the left and their targets on the right.

- The closed picker is an `.hd-select` button with three dots on the right. It shows the picked target (devices as `Name — Zone`), "Pick a device" when none is picked, or "Not found in Homey".
- Devices, moods and recorded values are grouped by zone, flows by flow folder. The left side is the tree of zones or folders, nested as in Homey, each with how many targets it holds; "All devices" sits on top. Empty zones and folders are left out.
- The right side lists the targets in the picked zone and the zones below it: an icon in the target's kind hue, its name, and its type (`Light`, `Advanced flow`, `Mood`), followed by its zone when that is not the picked one.
- The dialog opens on the zone of the current target, which is outlined.
- The search field has focus when the dialog opens. It looks through every zone, matching every word against a target's name, type and zones, so "living light" finds the lights in the living room; the left side then shows only the zones with matches. Enter picks the first match; Escape, Cancel or a click outside closes without picking.
