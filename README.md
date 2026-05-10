# Journal Scaler Plus

Quality-of-life tools for Foundry VTT v14 journals.

System-agnostic.

## Features

### Font scaling

- Per-user, persistent scale from 50% to 300% (stored as a client setting).
- Three controls in the journal header: zoom out, reset to 100%, zoom in (10% step).
- Ctrl+scroll and trackpad pinch-zoom over journal content (5% step).
- Sidebar (page navigation) is never scaled, so navigation stays readable at any zoom.
- Works on detached / popped-out journal windows (Foundry v14 native feature).
- Honors `prefers-reduced-motion`.

### Markdown export (Obsidian-friendly)

Right-click a Journal Entry in the sidebar → **Export to Markdown** → save a `.zip`.

- One `.md` file per page, plus an `images/` folder with all embedded artwork.
- Internal page links and Foundry actor/scene references become Obsidian
  wikilinks (`[[Page Name]]`); aliases are preserved (`[[Target|Display]]`).
- Roll formulas, compendium item/spell references and other Foundry-only markup
  are flattened to italics so the prose stays readable.
- Embedded images from other journal pages are inlined and bundled.
- World-scoped setting controls the minimum role allowed to export.
- UTF-8, no BOM, sanitized filenames.

### Localization

English and Italian.

## Compatibility

- Foundry VTT v14 — verified.
- v13 — declared minimum, should work but not actively tested.

## Installation

### Via manifest URL (recommended)

In Foundry: *Setup → Add-on Modules → Install Module*, paste:

```
https://github.com/cirskizzo/journal-font-scaler/releases/latest/download/module.json
```

### Manual

Download the latest release from
[Releases](https://github.com/cirskizzo/journal-font-scaler/releases),
extract into your Foundry `Data/modules/journal-scaler-plus/` directory.

Then enable the module in your world (*Game Settings → Manage Modules*).

## Usage

### Font scaling

Open any Journal Entry. Three buttons appear in its header (before the close button):

- `−` zoom out (−10%)
- `↺` reset to 100%
- `+` zoom in (+10%)

You can also:

- Hold **Ctrl** and **scroll** over the journal content.
- **Pinch** with the trackpad over the journal content.

The scale applies to all open journal windows simultaneously and persists
across sessions. Each user has their own independent scale.

### Markdown export

1. In the journal sidebar, right-click the journal you want to export.
2. Pick **Export to Markdown**.
3. The system save dialog opens with a `.zip` named after the journal.
4. Unzip into your Obsidian vault — each page becomes a note, and inline
   wikilinks resolve against the other notes from the same export.

Settings: *Game Settings → Configure Settings → Module Settings → Journal Scaler Plus*.

- **Minimum role allowed to export** — defaults to *Gamemaster*.
  Users below this role won't see the menu item. They also need at least
  *Observer* permission on the specific journal.
- **Default download folder** — informational only. Browser/Electron security
  rules don't let modules pre-select a save location, but the value is shown
  as a reminder.

## License

MIT — see [LICENSE](LICENSE).
