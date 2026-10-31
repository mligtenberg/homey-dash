# PhotoTile

The photos of one photo set, one at a time, filling the tile like a photo frame. It suits a wall tablet in a hallway or kitchen, often as a `full-large` tile next to the controls.

## Markup

An `.hd-tile.hd-photo` with no kind hue. With a photo to show it gets `.has-photo`, loses its padding, and holds:

- One or two `img.hd-photo__img`, absolutely filling the tile with `object-fit: cover`, so the photo is cropped to the tile and never shows bars. The newest one fades in over the one before (`hd-photo-in`, 1.2 s); the older one is then dropped.
- `.hd-photo__label` at the bottom, white on a dark gradient, only when the tile has a label of its own. Without one the photo stands alone.

Without a photo it is a plain tile with an `.hd-icon` and the usual `.hd-tile__name` and `.hd-tile__detail`: `Pick a photo set`, `No photos in the album`, or `Photo set not found` with `is-missing`.

The detail view ([TileDetails](TileDetails.md)) is titled with the set's name (or the tile's label) and shows the date the photo was taken as its subtitle, such as `12 August 2026`. Below that, `.hd-photo-details` holds the photo whole (`object-fit: contain`), and an `.hd-details__row` holds the previous and next `.hd-round-btn`s with `3 of 48` between them.

## Behavior

- Each tile shows its set in an order of its own, so two tiles showing the same set don't stay in step. It moves to the next photo every 30 seconds unless the tile's settings say otherwise (10 seconds to 15 minutes), and only once that photo has loaded.
- While the connection to HomeyDash is lost, the tile keeps the photo it shows and stops moving on, like other tiles keep their last values.
- When the set's photos change, because its album changed in Immich or the set follows another album, the tile starts over with the new photos.
- A photo that can't be loaded, such as while Immich is out of reach, is skipped and the tile keeps the one it shows.
- A press opens the detail view at the photo shown. A swipe sideways, or the arrows, step through the set.
- With `prefers-reduced-motion`, photos change without fading.

## Don't

- Don't put text over the photo beyond the label; nothing on it is meant to be read from across the room.
- Don't use it for anything but a photo set. Pictures from Homey, such as a camera, need a kind of their own.
