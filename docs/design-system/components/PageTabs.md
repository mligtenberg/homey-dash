# Page tabs

The strip under a page header in Management that splits one place into pages: a display's Status, Dashboards, When idle and Lock screen, or Settings' Accounts, Speech recognition and Language.

- Use `<hd-page-tabs [tabs]="…" label="…" />` (`apps/management/src/app/page-tabs.ts`). Each tab has a `path` (a child route), a `label` and a `hint`. The page that holds it sets `--sec` to its place's colour and puts a `<router-outlet />` below.
- Every tab says what it holds in its one-line hint, so the right one is found without opening them all. Labels and hints are translated.
- The current tab has `aria-current="page"`, ink text and a 2px underline in the place's colour. Tabs scroll sideways when they do not fit.
- Keep the page header's `purpose` off (`[purpose]="null"`) and its bottom border off; the strip draws the line.
