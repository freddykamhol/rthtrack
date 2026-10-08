# Production deployment

Node.js 18+; startup file app.js; npm start locally. Passenger loads the CommonJS-compatible root startup file, which imports server.mjs and starts the HTTP listener. No extra runtime dependencies or PHP are needed.

Run npm ci and npm run build. The build always compiles client/index.html and src/main.tsx, verifies current feature code, and copies generated HTML/assets to the repository root for the existing Git deployment. Do not edit generated root HTML. Commit generated assets with source changes. Restart Passenger after deployment (the tracked tmp/restart.txt triggers a restart when updated).

Verify /api/health, /adsb-live, and profile GET/PUT on /api/rthtrack/settings before declaring success. The server provides a shared 25-second ADSB.fi cache for north/south Germany, filters old positions, and returns errors rather than demo data. ADSB.fi personal/non-commercial terms: https://github.com/adsbfi/opendata

Profiles and landing pads are stored in ../rthtrack-data outside the document root. Optionally set RTHTRACK_DATA_DIR to another persistent writable directory outside the public document root. Back up that directory and retain it on deploy. File locks serialize writes and atomic renames protect committed data. A crashed process may leave a .lock file: after confirming no application process is using it, the administrator can remove that lock to resume writes.

The private 256-bit profile link is the credential. Save it as a bookmark; open the same link on other devices. Anyone holding the link can edit its data. No browser storage is used for settings. Revision checks reject stale concurrent edits. Reload after a conflict.

Configure nginx to serve HTML with Cache-Control: no-cache. Hashed assets may use long-lived caching. Prefer the built dist as public document root (keep Passenger application root at the repository). Never expose source, environment, or profile storage through nginx. GitHub Pages alone cannot execute the Node backend.
