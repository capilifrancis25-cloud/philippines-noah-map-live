# Philippines Hazard Map

Public web viewer for Philippine flood, landslide, and storm surge hazard layers. The static application and its source configuration are in `dist/`. Map tiles are loaded from the sources listed in `dist/manifest.json`.

## Cloudflare Pages

Use the Git integration with production branch `main`, no framework preset, a blank build command, and `dist` as the build output directory.

Hazard data is credited to UP Project NOAH and the BetterGov.PH mirror. The basemap uses OpenStreetMap data via HOT and BetterGov.PH. Software and font license notices are in `dist/licenses/`.
