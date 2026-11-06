# Sidebar

Management's navigation: dashboards first, then displays.

- Use `.hd-nav` with `.hd-nav__group` headings and `.hd-nav__item` buttons. The current item has `aria-current="page"`. Items show a [Ripple](Ripple.md) when pressed.
- Displays list under "All displays", one item each with a dot that is green while the display is connected. A display opens to its own pages: Details, Dashboards, When idle and Lock screen, as tabs under its name and status.
- A dashboard item shows a "Draft" pill when it has unpublished changes, and a warning dot when it contains a missing tile.
- Below 860px wide, the sidebar becomes a horizontal strip above the page.
