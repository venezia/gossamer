# How It Works

Gossamer handles two very different target types with a unified interface.

## Overview

```
  +----------+     +----------------+     +-----------+
  | cert.pem +---->|                +---->| TrueNAS   |  REST API
  | key.pem  |     |   Gossamer     |     +-----------+
  |          |     |                |
  | targets  +---->|  1. Read cert  |     +-----------+
  | .json    |     |  2. Convert    +---->| IPMI BMC  |  Headless browser
  |          |     |     key format |     +-----------+
  | ENV vars +---->|  3. Push to    |
  | (creds)  |     |     each target|     +-----------+
  +----------+     |  4. Report     +---->| IPMI BMC  |  Headless browser
                   |     results    |     +-----------+
                   +----------------+
```

## TrueNAS (REST API)

The TrueNAS integration is straightforward REST:

1. **Import** -- `POST /api/v2.0/certificate` with the PEM cert and key.
   TrueNAS processes this asynchronously; gossamer polls the job until
   it completes.

2. **Activate** -- `PUT /api/v2.0/system/general` with the new cert's ID
   to make it the active UI certificate.

3. **Restart** -- `POST /api/v2.0/system/general/ui_restart` to apply the
   new cert. Gossamer waits for the UI to come back (polls every 5 seconds,
   up to 60 seconds).

4. **Cleanup** -- Lists all certificates and deletes any previously imported
   by gossamer (matching the `gossamer-*` naming pattern), keeping only the
   freshly imported one and the original `truenas_default` cert.

All API calls use `rejectUnauthorized: false` because the cert being
replaced might be expired or self-signed.

## Supermicro IPMI (Headless Browser)

The IPMI integration is more complex because Supermicro BMCs don't have
a usable API for certificate management. Gossamer drives the actual web
UI using Playwright (headless Chromium).

### Why a Browser?

We tried the REST/CGI approach first. Supermicro BMCs expose a Redfish
API, but certificate management endpoints aren't available on older
firmware (tested: ASPEED BMC firmware 4.1). The CGI upload endpoint
(`/cgi/upload_ssl.cgi`) exists but has CSRF token handling that's
incompatible with `curl`-style multipart uploads.

The browser approach works because it exercises the exact same code path
as a human clicking through the UI -- CSRF tokens, JavaScript-set form
field names, and confirmation dialogs are all handled naturally.

### The BMC Web UI

Supermicro BMCs (ATEN-based) use a frameset with:
- **topmenu** -- navigation tabs
- **MainFrame** -- the content area
- **HelpFrame** -- context help

The SSL configuration page lives at
`Configuration > SSL Certification` in the MainFrame.

### Browser Automation Flow

1. **Login** -- Fill username/password on the login page, submit.
   The BMC loads a frameset with multiple frames.

2. **Navigate** -- Find the `MainFrame` by name and navigate it to
   `/cgi/url_redirect.cgi?url_name=config_ssl`. This avoids the
   frame-buster JavaScript that redirects to `/` when the SSL page
   is loaded directly.

3. **Wait for JS** -- The page's `PageInit()` function sets `NAME`
   attributes on the file inputs (`/etc/actualcert.pem?16384` and
   `/etc/actualprivkey.pem?16384`). Gossamer waits for this before
   uploading.

4. **Upload** -- Set the cert and key files on the two `<input type="file">`
   elements. Files must have `.pem` extension (the BMC validates this
   client-side).

5. **Submit** -- Click the Upload button. The BMC validates the
   cert/key pair server-side.

6. **Reset** -- Navigate the MainFrame to
   `/cgi/url_redirect.cgi?url_name=config_ssl_fw_reset` to trigger
   the BMC's SSL subsystem reset. This reboots the BMC web interface
   (not the host server).

7. **Wait** -- Poll the BMC every 10 seconds until it responds again
   (typically 30-60 seconds).

### Important Notes

- The BMC reboot only affects the management interface, **not** the
  host server. Your running workloads are unaffected.
- The private key must be PKCS#8 format. Gossamer converts
  automatically.
- BMC sessions are short-lived. All steps happen in a single browser
  session to avoid timeout issues.
- Dialog handling: the BMC may show JavaScript `alert()` dialogs
  (e.g., "Session timed out"). Gossamer auto-accepts these.

## Error Handling

Gossamer processes targets sequentially. If one target fails:

- The error is logged with the host name
- Processing continues with the next target
- A summary is printed at the end
- The exit code is 1 if any target failed, 0 if all succeeded

This means a single unreachable BMC won't prevent the other five
targets from getting updated.

## Compatibility

### TrueNAS
- TrueNAS SCALE (tested)
- TrueNAS CORE (should work -- same API)
- Requires API v2.0

### Supermicro IPMI
- X11 motherboards with ATEN-based BMC (tested: firmware 4.1)
- Other Supermicro generations with the same web UI layout should work
- Not tested: X12, X13, H12, H13 (contributions welcome)
