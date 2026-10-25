# HomeyDash

A configurable smart-home control surface for a Homey hub, shown on screens placed around the home.

## Language

**Dashboard**:
A named, configured layout of tiles with a fixed number of rows. It exists independently of any physical screen and can be shown on several displays at once.
_Avoid_: Page, screen, view

**Display**:
A physical screen in the home that has completed setup, assigned at most one dashboard at a time. Identified by a permanent identity that never changes; its name is only a human-readable label.
_Avoid_: Screen, device, client, kiosk

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
A realistic rendering of a dashboard's draft in Management, using real tiles and live data, fitted to the size of the Management window.
_Avoid_: Simulation, mockup

**Published version**:
The version of a dashboard that displays show.
_Avoid_: Live version, current version

**Connection lost**:
The state of a display that cannot reach HomeyDash, or whose HomeyDash cannot reach Homey. The dashboard stays visible with its last known values, cannot be interacted with (horizontal scrolling still works), and shows a reconnecting indicator until it recovers on its own.
_Avoid_: Offline, stale, disconnected

**Management**:
A separate application, apart from the one displays run, where dashboards are built and displays are assigned a dashboard. The only place configuration changes. Opening it never triggers setup.
_Avoid_: Management environment, admin, settings, backend

**Homey**:
The smart-home hub (a Homey Pro) that owns all devices and their state. The source of truth for anything in the home.
_Avoid_: Hub, controller, gateway

**Device**:
Something Homey controls or reads, such as a light, sensor, or thermostat. Never a screen.
_Avoid_: Accessory, thing, appliance

### Layout

**Section**:
A group of tiles within a dashboard, laid out on a grid three cells wide and as many rows tall as its dashboard. Cells may be left empty.
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
The thing in Homey a tile points at, such as a device, a flow, a mood or a recorded value. Every tile kind defines what kind of target it takes.
_Avoid_: Source, binding, subject

**Unavailable**:
The state of a tile whose target still exists in Homey but cannot currently be reached. The tile shows its last known value marked as unavailable and recovers on its own.
_Avoid_: Offline, disconnected

**Missing**:
The state of a tile whose target no longer exists in Homey. The tile shows that its target was not found, and Management flags every dashboard containing it. It is never removed automatically.
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

**Statistic tile**:
A tile showing the history of one recorded value over a chosen time window, with its current value, updating live as new values arrive.
_Avoid_: Graph tile, chart tile, insight tile

## Relationships

- A **Display** shows at most one **Dashboard**; a **Dashboard** can be shown on zero or more **Displays**.
- A **Display** with no assigned **Dashboard** shows a waiting state until one is assigned in **Management**.
- A **Display** always shows the **Published version** of its **Dashboard**; a **Dashboard** that has never been published cannot be assigned to a **Display**.
- A **Display** in **Connection lost** picks up a newer **Published version** when it recovers.
- A **Display** only uses its **Dashboard**; it never changes configuration.
- A **Display** is held by exactly one physical screen at a time; sharing a layout across screens is done by sharing a **Dashboard**.
- A **Dashboard** is an ordered list of **Sections**; a **Section** holds **Tiles** at explicit **Tile positions**.
- **Tiles** in a **Section** never overlap and never extend beyond its grid.
- A **Display** places all **Sections** side by side in one horizontal row. A **Dashboard** never scrolls vertically; when its **Sections** are wider than the screen, it scrolls horizontally.
- A **Display** never talks to **Homey** directly; HomeyDash is the only party that speaks to **Homey** on its behalf.
