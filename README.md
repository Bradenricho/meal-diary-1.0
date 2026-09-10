# Meal & Insulin Diary — setup

This is a small standalone app: a home-screen icon that opens straight to
the diary, works offline, and saves everything only on the phone it's
opened on. No account, no login, no Claude plan involved.

## 1. Put it online (one-time, ~5 minutes)

1. Go to https://github.com and create a free account (skip this if you
   already have one).
2. Click the **+** in the top right → **New repository**.
   - Name it something like `meal-diary`.
   - Set it to **Public**.
   - Click **Create repository**.
3. On the new repository page, click **Add file → Upload files**.
4. Drag in every file from this folder, **keeping the `icons` folder
   structure intact** (so it stays `icons/icon-192.png`, not just
   `icon-192.png` loose in the main folder).
5. Scroll down and click **Commit changes**.
6. Go to the repository's **Settings** tab → **Pages** (left sidebar).
7. Under "Build and deployment", set **Source** to **Deploy from a
   branch**, branch **main**, folder **/ (root)** → **Save**.
8. Wait about a minute, then refresh that Pages settings screen — it'll
   show a link like:

   `https://yourname.github.io/meal-diary/`

That link is the app.

## 2. Install it on her phone

Open that link in her phone's browser, then:

- **iPhone (Safari):** tap the Share icon (square with an arrow) →
  **Add to Home Screen**.
- **Android (Chrome):** tap the **⋮** menu → **Install app** (Chrome
  often prompts this automatically after a few seconds on the page).

From then on it's an icon on her home screen, opens full-screen with no
browser bar, and keeps working with no signal once it's been opened once.

## 3. Bringing over what's already logged

If there's existing data from the Claude-artifact version:

1. Open that version and tap **Copy backup**.
2. Open this new app and tap **Restore backup**, then paste it in.

## Good habits going forward

- **Copy backup** occasionally (monthly is plenty) and save that text
  somewhere safe, like a notes app. This app's data lives only in this
  one browser/device — if she gets a new phone, clears her browser data,
  or uninstalls, a backup is the only way to bring it back.
- **Export CSV** before a doctor's appointment — opens cleanly in any
  spreadsheet app for review or printing.

## Updating the app later

If you ever want changes made, come back to Claude, describe what you
want, and re-upload the changed files the same way (Add file → Upload
files → they'll overwrite the old ones since the names match). The web
address stays the same.

**After uploading any update:** fully close the app on the phone
(swipe it away like any other app, don't just background it) and
reopen it. Because the app works offline, it keeps its own saved copy
of the code — closing and reopening is what makes it check for and
switch to the new version. This only needs to happen once per round of
changes, not once per file.

