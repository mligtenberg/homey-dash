# Ripple

Press feedback on every pressable surface in both apps, like the ripple on an Angular Material button: a faint circle spreads from the exact point a finger or mouse goes down, clipped to the surface's rounded shape, and fades once it lifts. On a display it sits on top of the press scale, so a tap shows where it landed.

## Where it ripples

- Management: `.hd-btn` (with `--primary` and `--danger`) and `.hd-nav__item`.
- Displays: `.hd-round-btn` (a tile's quick action, steppers, the detail view's close button), `.hd-segmented` buttons, `.hd-mood-list__btn`, the [DashboardTape](DashboardTape.md)'s `.hd-tape__item` and `.hd-tape__toggle`, and an `.hd-tile` with `data-tap`, whose press opens its [TileDetails](TileDetails.md).

The innermost surface wins: a press on a control inside a tile ripples the control, not the tile. A press on a tile's slider, or anywhere in its open detail view, never ripples the tile. Disabled buttons (`disabled` or `aria-disabled="true"`) don't ripple, and neither do tiles in Management's editor, where an overlay takes the press.

## How it works

`installRipple()` from `@homey-dash/design-system` (`libs/design-system/src/lib/ripple.ts`) listens for presses on the whole document; each app calls it once in `main.ts`. A press adds `<span class="hd-ripple"><span class="hd-ripple__wave"></span></span>` to the surface and removes it after the fade. No markup or directive is needed on the surface itself. A new pressable class joins by adding it to `RIPPLE_SURFACES`.

- `.hd-ripple` fills the surface's padding box with `border-radius: inherit` and `overflow: hidden`, so the circle follows the surface's corners, and the 44px touch areas around small controls stay untouched. The surface must be positioned: `position: relative`.
- `.hd-ripple__wave` is placed and sized in percentages of the surface, and its diameter reaches the farthest corner. It scales with the cell size like everything else on a display, and never uses pixels.
- The colour is the `ripple` token: the surface's own text colour (`currentColor`) at 20%. It reads on any fill in both themes, such as `ink` on a tile, `on-brand` on the primary button or `on-kind` on a quick action.
- The circle spreads in 450ms and fades in 300ms once the pointer lifts, or when the browser takes the pointer for a swipe. A quick tap still shows the full spread first.

## Reduced motion

With `prefers-reduced-motion`, there is no spread or fade. The circle covers the whole surface at once, so it becomes a plain highlight for as long as the press lasts.

## Don't

- Don't add a ripple to something that is not pressable, such as a slider or a chart. Their feedback is the value they show.
- Don't set the ripple's colour per component. Change the text colour, and the ripple follows.
