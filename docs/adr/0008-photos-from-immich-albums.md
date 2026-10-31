# Photos come from Immich albums or rules, fetched through HomeyDash

A photo tile shows a photo set, made in Management: a named link to an album in the home's Immich server, or rules to draw photos from Immich at random. Rules say who should be in the photos (at least one of them), who should not, what should be in them (Immich's smart search, such as "landscape"), how many to draw and how often to draw again: every hour, 6 hours, day or week, or only when asked. For an album, HomeyDash keeps the list of the album's photos (photos only, no videos) and syncs it with Immich when the set is made or pointed at another album, when someone presses Sync now, and every 15 minutes. Displays get each photo from HomeyDash, which fetches Immich's preview of it as it is asked for; displays never talk to Immich. Adding photos to the album in Immich adds them to every tile showing the set.

## Considered Options

- **Google Photos through the Picker, with HomeyDash keeping copies.** Built first, then replaced. Since 31 March 2025 Google's Library API only returns photos an app created itself, so a set could not follow an album: someone had to pick its photos again in Google's Picker to change it. It also took an OAuth client registered in Google Cloud per install, and signing in only worked with Management opened at `localhost` or an https address.
- **Keep copies of Immich's photos, as the Google version did.** Rejected for now: photo tiles would keep working while Immich is down, but at about 0.5 MB a photo next to the database. Immich runs on the home network like HomeyDash, so it is rarely out of reach when HomeyDash is not.
- **Hand-picked photos from Immich, rather than an album.** Rejected: it needs a photo picker in Management, and an album in Immich already is a hand-picked set that people know how to change.
- **Rules with "all of these people" rather than "at least one".** Rejected: a family frame wants photos of any of them; "all of them" makes small sets fast.
- **Leave people out with Immich's own filter.** Not yet: `filter.personIds.none` only exists from Immich 3.2. HomeyDash fetches the photos of each person to leave out and drops them itself, so rules work on older Immich too.
- **iCloud.** Rejected, as before: there is no official API.

## Consequences

- A smart search ranks every photo by how well it matches, so a rule's query only draws from the best matches, twice as many as the photos it draws.
- Setting up Immich takes its address and an API key with at least the `album.read`, `asset.read`, `asset.view`, `face.read` and `person.read` permissions, entered under Accounts ([ADR-0007](0007-accounts-set-up-in-management.md)). HomeyDash checks both with Immich before keeping them.
- A home can have several Immich accounts, each with a name, such as a server per household or a key per person. A photo set draws from one of them: the oldest unless another is chosen. Choosing an album of another account moves the set to that account. Removing an account leaves its sets without one, keeping their photos list, until they are given another.
- When Immich can't be reached, photo tiles keep the photo they show and photos browsers have kept (for a day) still show, but new ones don't load. Photo tiles still work without the internet, in line with [ADR-0002](0002-homeydash-is-the-only-homey-client.md), as long as Immich runs on the home network.
- The photo endpoint only serves photos in a photo set's list, so a display can't use HomeyDash to reach the rest of Immich.
- An album's photos are read with Immich's `/search/metadata`, since Immich 3 no longer lists them with the album. The client pages by number and, from Immich 3.2, by cursor, so it works with Immich 1.1xx to 3.x.
- A photo tile crops each photo around the faces Immich found in it. Immich's search no longer returns faces, so after a sync HomeyDash reads them from `/faces` once for each new photo, in the background, and keeps them with the photo. A key without `face.read` leaves photos cropped around their middle.
- A sync that fails keeps the list as it was and shows why in Management, on the set and in the tile editor.
- Photo sets picked from Google Photos were deleted by the migration to Immich: they had no album to follow.
- No person needs to be in a browser to make a photo set any more, so assistants could make them over MCP ([ADR-0006](0006-mcp-server-for-assistants.md)); for now they can only use the ones that exist.
