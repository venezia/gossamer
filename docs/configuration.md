# Configuration

Gossamer uses a JSON targets file to define which hosts receive certificates,
and environment variables for credentials.

## Targets File

Create a `targets.json` file listing your hosts:

```json
[
  {
    "host": "nas1.example.com",
    "type": "truenas",
    "tokenEnv": "TRUENAS_NAS1_TOKEN"
  },
  {
    "host": "nas1-ipmi.example.com",
    "type": "ipmi",
    "usernameEnv": "IPMI_USERNAME",
    "passwordEnv": "IPMI_PASSWORD"
  }
]
```

Each target references environment variables by name for credentials --
secrets are never stored in the config file.

## Target Types

### `truenas`

Pushes the certificate via the TrueNAS REST API:

```
  Gossamer                          TrueNAS
     |                                 |
     |  POST /api/v2.0/certificate     |
     |  (import cert + key)            |
     |-------------------------------->|
     |                                 |
     |  PUT /api/v2.0/system/general   |
     |  (set as active UI cert)        |
     |-------------------------------->|
     |                                 |
     |  POST /api/v2.0/system/general/ |
     |        ui_restart               |
     |-------------------------------->|
     |                                 |
     |  ... wait for UI restart ...    |
     |                                 |
     |  GET /api/v2.0/certificate      |
     |  (list all, delete old ones)    |
     |-------------------------------->|
```

**Requirements:**
- TrueNAS SCALE or CORE with API v2.0
- An API token (create one in TrueNAS UI: top-right user icon > API Keys > Add)

**Config fields:**
| Field | Description |
|-------|-------------|
| `host` | TrueNAS hostname or IP |
| `type` | Must be `"truenas"` |
| `tokenEnv` | Name of the environment variable containing the API bearer token |

### `ipmi`

Uploads the certificate via the Supermicro BMC web interface using a
headless Chromium browser (Playwright):

```
  Gossamer (Playwright)             Supermicro BMC
     |                                 |
     |  POST /cgi/login.cgi            |
     |  (authenticate)                 |
     |-------------------------------->|
     |                                 |
     |  GET mainmenu (frameset)        |
     |  Navigate MainFrame to          |
     |  /cgi/url_redirect.cgi?         |
     |   url_name=config_ssl           |
     |-------------------------------->|
     |                                 |
     |  Upload cert + key via          |
     |  file input fields              |
     |  Click "Upload" button          |
     |-------------------------------->|
     |                                 |
     |  GET /cgi/url_redirect.cgi?     |
     |   url_name=config_ssl_fw_reset  |
     |  (trigger BMC SSL reset)        |
     |-------------------------------->|
     |                                 |
     |  ... BMC reboots (30-60s) ...   |
     |                                 |
     |  Poll until BMC responds        |
     |-------------------------------->|
```

**Requirements:**
- Supermicro motherboard with ATEN-based BMC (X11 and similar)
- A BMC admin account
- Certificate files must have `.pem` extension (handled automatically)

**Tested firmware:**
- Supermicro X11 (ASPEED BMC, firmware 4.1)

**Config fields:**
| Field | Description |
|-------|-------------|
| `host` | BMC hostname or IP |
| `type` | Must be `"ipmi"` |
| `usernameEnv` | Name of the environment variable containing the BMC username |
| `passwordEnv` | Name of the environment variable containing the BMC password |

## CLI Options

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--config` | `TARGETS_CONFIG` | `/config/targets.json` | Path to targets JSON file |
| `--cert` | `CERT_PATH` | | Path to certificate PEM file |
| `--key` | `KEY_PATH` | | Path to private key PEM file |
| `--fetch-secret` | `FETCH_K8S_SECRET=true` | `false` | Read cert from a Kubernetes Secret |
| `--secret-namespace` | `SECRET_NAMESPACE` | `istio-ingress` | Namespace of the K8s TLS secret |
| `--secret-name` | `SECRET_NAME` | `quacks-org-tls` | Name of the K8s TLS secret |

## Key Format

Supermicro IPMI requires PKCS#8 format private keys (`BEGIN PRIVATE KEY`).
Gossamer automatically detects PKCS#1 RSA keys (`BEGIN RSA PRIVATE KEY`)
and converts them to PKCS#8. No manual conversion needed.
