# Journal Scaler Plus

A small Foundry VTT module that lets each user zoom Journal Entry content
independently, persistently, and without affecting Foundry's global font.
Works on both regular and detached (popped-out) journal windows in v14.

System-agnostic.

## Features

- Per-user, persistent scale from 50% to 300% (stored as a client setting).
- Three controls in the journal header: zoom out, reset to 100%, zoom in (10% step).
- Ctrl+scroll and trackpad pinch-zoom over journal content (5% step).
- Sidebar (page navigation) is never scaled, so navigation stays readable at any zoom.
- Works on detached / popped-out journal windows (Foundry v14 native feature).
- English and Italian localization.
- Honors `prefers-reduced-motion`.

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

Open any Journal Entry. Three buttons appear in its header (before the close button):

- `−` zoom out (−10%)
- `↺` reset to 100%
- `+` zoom in (+10%)

You can also:

- Hold **Ctrl** and **scroll** over the journal content.
- **Pinch** with the trackpad over the journal content.

The scale applies to all open journal windows simultaneously and persists
across sessions. Each user has their own independent scale.

## License

MIT — see [LICENSE](LICENSE).
