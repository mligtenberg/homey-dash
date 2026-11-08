# HomeyDash

A configurable smart-home control surface for a Homey hub, shown on screens placed around the home.

## Language

**Dashboard**:
A named, configured layout of tiles with a fixed number of rows. It exists independently of any physical screen and can be shown on several displays at once.
_Avoid_: Page, screen, view

**Display**:
A physical screen in the home that has completed setup, assigned an ordered list of dashboards to switch between. It starts on the first. Identified by a permanent identity that never changes; its name is only a human-readable label.
_Avoid_: Screen, device, client, kiosk

**Left alone**:
The state of a display that nobody has touched for a minute, and that it starts in. Left alone, it shows what its **Idle rules** choose and follows them as they change, and stays on what it shows while none holds; a touch keeps it on what it shows until it is left alone again.
_Avoid_: Idle mode, screensaver, inactive, main dashboard

**Idle rule**:
A **Rule** and what a display does while it holds: show one of its dashboards, play a **Photo set** full screen, fill the screen with one colour (such as black at night), or turn the screen off (in Fully Kiosk Browser, which a motion it sees or a touch turns on again; in any other browser the screen goes black); a display has an ordered list of them, set in **Management**. Left alone, the display does what the first rule that holds says, else stays where it is. A photo set or colour stays until a touch, which goes back to the dashboard the rule names, or to the one shown before. It only names a dashboard the display offers; one that shows a dashboard no longer offered goes, and one that went back to it goes back to the one shown before instead. A photo set that is gone or has no photos is passed over.
_Avoid_: Schedule, home rule, auto-switch

**Lock screen**:
What a display shows over the photo set or colour an **Idle rule** plays: its **Lock screen widgets**, each in one of five spots (the four corners and the middle), set per display in **Management**. It comes and goes with the photo set or colour, so a touch ends it too; a display never shows it over a dashboard.
_Avoid_: Screensaver, overlay, clock screen

**Lock screen widget**:
One thing on a **Lock screen**: the time and date, the weather where a Homey is (Homey's own weather, of the oldest Homey or a chosen one), or the value of one capability of a **Device**. Widgets in the same spot stack in order. One that has nothing to show, such as a weather Homey hasn't told yet or a value whose device is gone, is left out. It can't be operated; touches go through it.
_Avoid_: Tile, complication

**Dashboard tape**:
Pills floating over the left edge of a display that offers more than one dashboard, one per dashboard in the display's order, for switching between them. It can be collapsed to one button, which the screen remembers. A display with one dashboard has no tape.
_Avoid_: Tab bar, menu, dashboard picker

**Screen settings**:
What is set on one screen itself rather than in **Management**, such as which camera it estimates the light falling on it with. Hidden from the household: five quick taps in the top-right corner open it, during **Setup** too. Kept on the screen, so a **Takeover** doesn't carry it over.
_Avoid_: Admin menu, debug menu, device settings

**Display status**:
What Management knows about a display beyond its configuration: whether it is connected, when it was last seen, and whether it shows the latest published version of its dashboard.
_Avoid_: Health, heartbeat

**Setup**:
The first-run step on a screen where it either becomes a new display (and is given a name) or takes over an existing one.
_Avoid_: Pairing, registration, onboarding

**Takeover**:
A screen in setup adopting an existing display's identity, name and dashboard. The screen that previously held that identity is no longer that display and returns to setup.
_Avoid_: Claim, re-pair, restore

**Draft**:
The working version of a dashboard that is edited in Management. Displays never show a draft.
_Avoid_: Work in progress, unsaved changes

**Publish**:
Making a dashboard's draft its published version. Every display showing that dashboard switches to it at once.
_Avoid_: Deploy, release, save

**Editor**:
The part of Management where a dashboard's draft is arranged on its grid. Tiles appear with their real content but cannot be operated; they can only be placed, resized and configured.
_Avoid_: Designer, builder, canvas

**Preview**:
A realistic rendering of a dashboard's draft in Management, using real tiles and live data, fitted to the size of the Management window. Its tiles can be operated as on a display, so they operate the home.
_Avoid_: Simulation, mockup

**Published version**:
The version of a dashboard that displays show.
_Avoid_: Live version, current version

**Connection lost**:
The state of a display that cannot reach HomeyDash, or whose HomeyDash cannot reach a Homey the dashboard has tiles of, including when no Homey account is set up yet. The dashboard stays visible with its last known values and shows a reconnecting indicator until it recovers on its own. Without HomeyDash, no tile can be interacted with (horizontal scrolling still works); without a Homey, only that Homey's tiles can't.
_Avoid_: Offline, stale, disconnected

**Management**:
A separate application, apart from the one displays run, where dashboards are built and displays are assigned a dashboard. AI assistants can make the same changes through the MCP server (ADR-0006), but Management is the only place where a dashboard is arranged visually and where dashboards and displays are deleted, accounts are set up, and photo sets are made. Opening it never triggers setup.
_Avoid_: Management environment, admin, settings, backend

**Homey**:
The smart-home hub (a Homey Pro) that owns all devices and their state. The source of truth for anything in the home. A home can have more than one, each set up as its own **Account**.
_Avoid_: Hub, controller, gateway

**Device**:
Something Homey controls or reads, such as a light, sensor, or thermostat. Never a screen.
_Avoid_: Accessory, thing, appliance

**Account**:
A sign-in HomeyDash holds for the home, so it can reach a service on everyone's behalf: Homey, Immich or Plex. Set up in Management; displays never hold one. A home can have several accounts of each, such as one Homey per house, one per person's Immich or one per Plex server, each with a name that tells them apart. A Homey or Plex tile points into one account: the one it names, or the oldest.
_Avoid_: Connection, integration, credential

### Layout

**Background**:
What a dashboard shows behind its tiles: the theme's own, one colour, a gradient between two colours, a built-in image (one subject, such as the living room or the garden, drawn in one style, such as pixel art, by day in the light theme and by night in the dark one, in its own colours or in a **Colour scheme**), or an image uploaded in **Management**. It belongs to the dashboard's version, so it changes on displays only when the draft is published. Over an image, tiles turn to glass so they stay readable. An uploaded image no version uses any more is let go after a day.
_Avoid_: Wallpaper, theme, backdrop

**Colour scheme**:
Four colours a built-in image is redrawn in: one picked colour, a second a chosen angle further around the hue wheel, and the two opposite those. Only their hues and how vivid they are carry over; how light each part is stays the image's own, so it stays light by day and dark by night. Displays show the image as HomeyDash renders it for their screen, rather than drawing it themselves.
_Avoid_: Palette, tint

**Section**:
A group of tiles within a dashboard, laid out on a grid three cells wide and as many rows tall as its dashboard. Cells may be left empty. Displays show it always, never, or only while a **Rule** holds, evaluated as a **Logic tile**'s is; the **Editor** always shows it, dimmed when a display would leave it out.
_Avoid_: Group, panel, column, area

**Cell**:
One unit of a section's grid. Tile sizes are expressed in cells. A cell's size follows from the display's screen height divided by the dashboard's number of rows, so a dashboard always exactly fills the screen height.
_Avoid_: Slot, unit

### Tiles

**Module**:
A self-contained extension of HomeyDash that registers one or more tile kinds, each with the tile sizes it supports. New capabilities are added by adding modules.
_Avoid_: Plugin, extension, package

**Tile**:
One placed element on a dashboard, belonging to exactly one section. Every tile is of exactly one tile kind.
_Avoid_: Card, widget, block

**Tile kind**:
The category of a tile, registered by exactly one module, which determines what it targets, how it is configured, what it shows, and how it is interacted with (tap action or inline controls). The set of tile kinds is expected to grow.
_Avoid_: Tile type, card type

**Target**:
The thing a tile points at: something in Homey, such as a device, a flow, a mood or a recorded value, or a photo set. Every tile kind defines what kind of target it takes.
_Avoid_: Source, binding, subject

**Unavailable**:
The state of a tile whose target still exists in Homey but cannot currently be reached. The tile shows its last known value marked as unavailable and recovers on its own.
_Avoid_: Offline, disconnected

**Missing**:
The state of a tile whose target no longer exists, in Homey or, for a photo set, in HomeyDash. The tile shows that its target was not found, and Management flags every dashboard containing it. It is never removed automatically.
_Avoid_: Broken, orphaned, deleted

**Tile position**:
The cell in its section's grid where a tile's top-left corner sits. Set explicitly in Management; tiles never move on their own.
_Avoid_: Order, slot

**Tile size**:
How many cells wide and tall a tile is, chosen from one fixed set: **Small** (1×1), **Wide** (2×1), **Full** (3×1), **Large** (2×2) and **Full large** (3×2). Each tile kind supports its own subset of this set, declared by its module.
_Avoid_: Span, dimensions

**Tap action**:
A tile interaction where pressing anywhere on the tile performs one action, such as toggling a light or starting a flow.
_Avoid_: Click action, primary action

**Inline controls**:
A tile interaction where the tile presents its own controls, such as a slider or several buttons, instead of acting as a single button.
_Avoid_: Custom control, widget

**Device tile**:
A tile showing one device, with a chosen subset of that device's capabilities to show and control.

**Flow tile**:
A tile that starts one Homey flow when pressed.

**Mood tile**:
A tile that activates one Homey mood when pressed.

**Photo tile**:
A tile that shows the photos of one photo set, one at a time in shuffled order, fading to the next at a chosen interval.
_Avoid_: Photo frame, slideshow tile, gallery tile

**Photo set**:
A named set of photos, made in Management, that follows one album in Immich or is drawn at random from Immich by a **Selection**. HomeyDash keeps the list of its photos, synced with Immich, and fetches each photo from Immich when a display shows it. It exists apart from any tile; photos added to or removed from the album follow at the next sync.
_Avoid_: Album, gallery, slideshow

**Excluded photo**:
A photo taken out of a **Photo set** from a photo tile's detail view on a **Display**. It leaves every tile showing the set at once, and no sync brings it back, also when the set is pointed at another album or draws again, until it is brought back in **Management**; it stays in Immich.
_Avoid_: Hidden photo, deleted photo, blocked photo

**Selection**:
The rules a **Photo set** draws its photos from Immich by: people who should be in them (at least one), people who should not, what they should show, how many, and how often to draw again.
_Avoid_: Filter, smart album, query

**Now playing tile**:
A Plex tile that shows what plays on one Plex player, or any, over its artwork, with buttons to skip back, play or pause, and skip on.
_Avoid_: Media tile, player tile

**Recently added tile**:
A Plex tile that shows the newest posters of one Plex library, or every library.
_Avoid_: New media tile

**Weather tile**:
A tile that shows the weather where a **Homey** is, or at a town chosen for the tile instead: now, and by its size the coming hours and days, and the rain of the next two hours where Buienradar knows it (ADR-0013). Without a town of its own the place is the location set in Homey, and the tile names its Homey like any Homey tile.
_Avoid_: Forecast widget, weather card

**Clock tile**:
A tile that shows the time, digital or as an analog dial, with the date where its size has room. It points at nothing and uses the display's own clock.
_Avoid_: Time tile

**Date tile**:
A tile that shows today's date, and on large sizes the month as a calendar with today marked, weeks starting on Monday. It points at nothing.
_Avoid_: Calendar tile (that is for events, which HomeyDash does not show)

**Energy tile**:
A tile that shows the energy of a **Homey** from Homey's own energy report (ADR-0014): the grid power now, importing or exporting, and by its size the sun's production, the home's consumption, today's totals and the day by the hour. It names its Homey like any Homey tile. A Homey whose API key lacks the energy scope, or that has no energy, makes it unavailable rather than missing.
_Avoid_: Power tile, solar tile

**Logic tile**:
A tile that holds an ordered list of other tiles, each with a rule, and shows the first whose rule holds, or its fallback tile when none does; with no fallback it shows nothing, like empty cells. It holds tiles of any kind except another logic tile, and a tile it holds that points at a missing target is shown as **Missing** when chosen, not skipped. The tiles it holds take its size, so it only holds kinds that support that size. It fades from one tile to the next, and once switched it can stay on a tile for a chosen **Minimum show time**, after which it shows whatever its rules then choose.
_Avoid_: Logic card, conditional tile, switch tile

**Minimum show time**:
How long a **Logic tile** keeps showing a tile it switched to before it may switch again, however its rules change; none by default.
_Avoid_: Debounce, hold time, delay

**Statistic tile**:
A tile showing the history of one recorded value over a chosen time window, with its current value, updating live as new values arrive.
_Avoid_: Graph tile, chart tile, insight tile

### Logic

**Signal**:
A named, live value HomeyDash knows, of one of four types: text, yes/no, number, or date and time. Signals come from sources such as a device's capabilities, Homey variables, the clock, the display a dashboard is shown on, or Plex; a module can add its own. A text signal may have a fixed set of values to choose from, such as a thermostat's modes; a condition comparing with a value no longer in that set stays, never holds, and is flagged in **Management**.
_Avoid_: Variable, token, input, fact

**Condition**:
One signal compared with a fixed value, by an operator that suits the signal's type, optionally negated.
_Avoid_: Check, test, filter

**Rule**:
One or more conditions, of which all, or any, must hold. A **group** among them is a rule of its own, so a rule can say "A and B, or C".
_Avoid_: Expression, logic, formula

## Relationships

- A **Display** offers zero or more **Dashboards**, in order, and shows one at a time, starting on the first; a **Dashboard** can be offered on zero or more **Displays**.
- A **Display** has zero or more **Idle rules**, each on one of the **Dashboards** it offers; HomeyDash evaluates them for that **Display**, as it does a **Logic tile**'s, and the **Display** itself picks the first that holds.
- A **Display** in **Connection lost** keeps showing the **Dashboard** its **Idle rules** last chose.
- A **Display** with no **Dashboards** shows a waiting state until one is assigned in **Management**.
- A **Display** always shows the **Published version** of its **Dashboards**; a **Dashboard** that has never been published cannot be assigned to a **Display**.
- Deleting a **Dashboard** takes it off every **Display**, with its **Idle rules**; a **Display** left with none waits.
- A **Display** in **Connection lost** picks up a newer **Published version** when it recovers.
- A **Display** only uses its **Dashboard**; it never changes configuration, but for **Excluded photos**.
- A **Display** is held by exactly one physical screen at a time; sharing a layout across screens is done by sharing a **Dashboard**.
- A **Dashboard** is an ordered list of **Sections**; a **Section** holds **Tiles** at explicit **Tile positions**.
- **Tiles** in a **Section** never overlap and never extend beyond its grid.
- A **Display** places all **Sections** side by side in one horizontal row. A **Dashboard** never scrolls vertically; when its **Sections** are wider than the screen, it scrolls horizontally.
- A **Display** never talks to **Homey** directly; HomeyDash is the only party that speaks to **Homey** on its behalf.
- A tile on **Homey** points into one Homey **Account**; removing that **Account** leaves the tile **Missing** until it is given another.
- A **Photo set** draws from one Immich **Account**, follows one album in it (or draws by a **Selection**), and can be the **Target** of several tiles; a change to the album, or pointing the set at another, changes every tile showing it. Removing that **Account** leaves the **Photo set**, but its photos can't be shown until it is given another **Account**.
- A **Display** never talks to Immich; it gets a **Photo set**'s photos through HomeyDash.
- An **Excluded photo** belongs to its **Photo set**: excluding it changes every tile showing that set, and no other set.
- HomeyDash evaluates every **Rule**, for as long as a shown **Dashboard** asks it to and separately for each **Display** showing it, and tells it at once whenever its answer changes; the **Logic tile** itself picks the first tile whose **Rule** holds. A **Preview** asks HomeyDash too, as if shown on a **Display** chosen in **Management**, or on none.
- A **Signal** from **Homey** belongs to one Homey **Account**; a **Rule** may mix **Signals** from several. Removing that **Account** makes the **Signal** **Missing**; an unreachable **Homey** makes it **Unavailable**.
- A **Condition** on a **Display**'s name refers to its permanent identity, so renaming the **Display** keeps the **Condition**, and a **Takeover** carries it over.
- A **Display** measures how much light falls on it in lux, once a minute, with its light sensor or else estimated with its camera, only when opened over https; until it has measured, a **Condition** on its brightness fails.
- The **Editor** shows the tile a **Logic tile**'s rules choose now, as the **Preview** would, except while one of the tiles it holds is being configured, which it then shows instead.
- A **Display** in **Connection lost** keeps showing the tile a **Logic tile** last chose.
- A **Condition** on an **Unavailable** **Signal** uses its last known value. A **Condition** on a **Missing** **Signal**, or on one that has never had a value, fails even when negated, so its **Logic tile** moves on to the next tile in its list; only a **Missing** one makes **Management** flag the dashboard.
