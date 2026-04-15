# Gossamer

Push TLS certificates to TrueNAS and Supermicro IPMI hosts automatically.

Gossamer solves a common homelab pain point: manually rotating TLS certificates
on TrueNAS storage servers and Supermicro IPMI BMCs. It supports pushing certs
via the TrueNAS REST API and driving the Supermicro BMC web UI with a headless
browser (Playwright).

## Supported Targets

- **TrueNAS SCALE/CORE** — REST API (`/api/v2.0/certificate`)
- **Supermicro IPMI** — Headless browser automation (ATEN-based BMC web UI)

## Quick Start

```bash
# Build the container
docker build -t gossamer .

# Run with cert files and a targets config
docker run --rm \
  -v /path/to/cert.pem:/certs/tls.crt:ro \
  -v /path/to/key.pem:/certs/tls.key:ro \
  -v /path/to/targets.json:/config/targets.json:ro \
  -e TRUENAS_NAS1_TOKEN=your-api-token \
  -e IPMI_USERNAME=admin \
  -e IPMI_PASSWORD=yourpassword \
  gossamer \
    --cert /certs/tls.crt \
    --key /certs/tls.key \
    --config /config/targets.json
```

## Configuration

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

Each target references environment variables for credentials — secrets are
never stored in the config file.

### Target Types

#### `truenas`
Pushes the certificate via the TrueNAS REST API:
1. Imports the cert and key
2. Sets it as the active UI certificate
3. Restarts the web UI
4. Cleans up previously imported certificates

Requires a TrueNAS API token (create one in the TrueNAS UI under your user's API Keys).

#### `ipmi`
Uploads the certificate via the Supermicro BMC web interface using Playwright:
1. Logs into the BMC
2. Navigates to Configuration > SSL Certification
3. Uploads cert and key files
4. Triggers an SSL reset (BMC reboots, takes ~30-60 seconds)

Requires a BMC admin account.

## Kubernetes CronJob

A Helm chart is included for deploying Gossamer as a Kubernetes CronJob.
It handles RBAC, secret management, and scheduling automatically.

```bash
helm install gossamer oci://ghcr.io/venezia/gossamer \
  --namespace cert-push --create-namespace \
  --set tlsSecret.namespace=istio-ingress \
  --set tlsSecret.name=wildcard-tls \
  --set-json 'targets=[{"host":"nas1.example.com","type":"truenas","tokenEnv":"TRUENAS_TOKEN"}]' \
  --set credentials.truenasTokens.TRUENAS_TOKEN=your-api-token
```

The chart creates:
- A **CronJob** (default: weekly on Monday at 3 AM)
- A **ServiceAccount** with RBAC to read the TLS secret from another namespace
- **Secrets** for TrueNAS API tokens and IPMI credentials
- A **ConfigMap** for the targets configuration

When running in a pod, Gossamer uses `--fetch-secret` to read the TLS
certificate directly from the Kubernetes API using the pod's service
account token.

See [`charts/gossamer/values.yaml`](charts/gossamer/values.yaml) for
all available configuration options.

## Key Format

Supermicro IPMI requires PKCS#8 format keys (`BEGIN PRIVATE KEY`).
Gossamer automatically converts PKCS#1 RSA keys to PKCS#8 — no
manual conversion needed.

## License

Apache License 2.0
