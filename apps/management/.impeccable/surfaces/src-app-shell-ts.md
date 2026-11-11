---
version: 1
slug: "src-app-shell-ts"
primary_target: "src/app/shell.ts"
related_targets: ["src/app"]
---

# Management

Scope: the whole Management app (shell, Overview, Dashboards, Displays, Photo sets, Accounts, the editor's frame, panels and pickers). Mode: Operate. The editor canvas (stage, slots, tiles) stays as it is.

Audience and job: the household admin, visiting every few weeks, who does not remember where things live. Main tasks: edit a dashboard's tiles; choose what a display shows (dashboards, idle rules, lock screen). Success: lands on an Overview that says what needs attention and where each task lives; any item is two clicks or one Go to search away.

## Direction contract

THESIS: Management as a quiet architect's drawing of the home: hairline-drawn, labelled like a plan, with each part of the home in its own colour. Refuses the grey sidebar-plus-one-accent default and the auto-open-first-dashboard landing.

OWN-WORLD: pale blue-grey sheet ground, white panels with 1px hairlines and small radii, ink text, small letter-spaced uppercase plan labels for section headings. Pops of colour: each section owns one hue (Dashboards violet, Displays teal, Photo sets green, Accounts amber) on its nav mark, its page marker and its items' marks; one ink-blue accent for actions and focus. Displays are drawn as framed screen outlines.

STORY: you arrive at Overview, see what needs attention and what every display shows, pick a task phrased as a question, and land in the right place; the sidebar always lists the same five places with counts, and the active section shows its items.

FIRST VIEWPORT: left: light sidebar, brand, Go to… (⌘K), five sections with colour marks and counts, the active section's items beneath it. Main: "Overview" title and one purpose line; left column the displays as drawn screens labelled with what they show and status; right column Needs attention, Unpublished changes, What do you want to do?

FORM: Architect's drawing, grounded candidate 2 of the safer hand (user pick, with added colour). seed:56f659ff9e5c9cf8

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
