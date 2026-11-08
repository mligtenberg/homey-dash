# Clock and date tiles

Two tiles that point at nothing, in the neutral hue. Both take every size but `full-tall`.

**Clock** (`.hd-clock`): the time centred, digital (`.hd-clock__digits`, sized by `--clock-size` per tile size and smaller while the seconds
show, with a 12 hour `AM`/`PM` as `.hd-unit`) or an analog dial (`.hd-clock__dial`, an SVG with twelve ticks, hour and minute hands, and a
`--kind-heat-ink` second hand only when the seconds show). From `wide` up the date (`Sunday 8 November`) shows under the time, beside the
dial on wide and full, unless turned off. Settings in Management: Look, Hours (Automatic, 12, 24), Seconds, Date.

**Date** (`.hd-date`): on `small` the short weekday in the hue's ink, the day of the month large and the short month; on `wide` and
`full` the long weekday, the day and `November 2026` side by side. On `large` and `full-large` the month as a table
(`.hd-date__month`), Monday first, the days of the neighbouring months muted, today on a filled chip in the hue's ink. Setting: Week
numbers (ISO 8601), a muted first column.

Neither takes a press or has a detail view, and neither is ever missing or unavailable.
