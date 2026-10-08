# RTHtrack deployment

Run `npm ci` and `npm run build`. The build always starts from `client/index.html` and `src/main.tsx`, checks that the current feature code is bundled, then publishes the generated root `index.html` and hashed `assets/`. Do not edit generated root HTML. Commit the generated assets together with source changes for the existing Git-based host.

Production requires PHP 7.4+ with cURL. Deploy `api.php` beside `index.html`. GitHub Pages alone cannot execute this backend. `api.php?action=health` reports storage and cURL readiness; `api.php?action=flights` returns current ADSB.fi data with a shared 25-second cache. Feed failures return HTTP 502 rather than fabricated positions. ADSB.fi permits personal, non-commercial use: https://github.com/adsbfi/opendata

Profiles and landing pads are stored in `../rthtrack-data` outside the web root. Optionally set `RTHTRACK_DATA_DIR` to a persistent writable directory outside the public document root. Back up this directory; do not clear it during deployments. No browser storage is used for profile data. The 256-bit private profile link is the credential: save it and open the same link on another device. Anyone holding the link can edit that profile. Concurrent writes use a revision check; conflicts require reloading before editing again.

Verify the production health endpoint, feed, and profile GET/PUT before declaring a deployment successful. Configure the web server to serve HTML with `Cache-Control: no-cache` and hashed assets with long-lived caching. Verify PHP files execute and are not served as source.
