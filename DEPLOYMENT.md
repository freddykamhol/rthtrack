# Production deployment

CARTO requires a Basemaps key. Set VITE_CARTO_API_KEY in .env.local before building, or in the build environment. GitHub Actions uses the repository secret of the same name. The compiled browser bundle includes this browser-facing key; .env.local itself stays untracked. The committed root bundle is already built with the configured key, so Plesk Git deployment does not need a separate key entry unless rebuilding there.

Node.js 18+; startup file app.js; npm start locally. Passenger loads the CommonJS-compatible root startup file, which imports server.mjs and starts the HTTP listener. No extra runtime dependencies or PHP are needed.

Run npm ci and npm run build. The build always compiles client/index.html and src/main.tsx, verifies current feature code, and copies generated HTML/assets to the repository root for the existing Git deployment. Do not edit generated root HTML. Commit generated assets with source changes. Restart Passenger after deployment (the tracked tmp/restart.txt triggers a restart when updated).

Verify /api/health, /adsb-live, and profile GET/PUT on /api/rthtrack/settings before declaring success. The server provides a 25-second in-memory cache per worker for north/south Germany, coalesces concurrent requests, filters old positions, and falls back from ADSB.fi to ADSB.lol. Feed retrieval never uses profile storage or disk locks; old feed.lock/feed.json files are ignored. Requests have a six-second deadline per provider/region. ADSB.fi personal/non-commercial terms: https://github.com/adsbfi/opendata. ADSB.lol API and ODbL license: https://www.adsb.lol/docs/open-data/api/

Profiles and landing pads are stored in ../rthtrack-data outside the document root. Optionally set RTHTRACK_DATA_DIR to another persistent writable directory outside the public document root. Back up that directory and retain it on deploy. File locks serialize writes and atomic renames protect committed data. A crashed process may leave a .lock file: after confirming no application process is using it, the administrator can remove that lock to resume writes.

The private 256-bit profile link is the credential. A one-year SameSite=Strict cookie remembers only this credential on the same browser, so opening the root URL returns to the same profile. Explicit profile links take precedence. Settings remain stored on the server. Save the profile link as a bookmark and open it on other devices. Anyone holding the link can edit its data. Revision conflicts are displayed without silently overwriting another client. Reload after a conflict. The finish button waits until the latest changes have been acknowledged; changes during a save are sent next.

For development run npm start alongside npm run dev; Vite proxies both /adsb-live and /api to the Node server on port 3000. Run npm test, npm run build, npm run test:browser, and npm run lint before publishing. Browser tests use installed Edge on Windows; on Linux install Chromium with npx playwright install chromium.

Configure nginx to serve HTML with Cache-Control: no-cache. Hashed assets may use long-lived caching. Prefer the built dist as public document root (keep Passenger application root at the repository). Never expose source, environment, or profile storage through nginx. GitHub Pages alone cannot execute the Node backend.
