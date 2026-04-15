# Gossamer

Push TLS certificates to TrueNAS and Supermicro IPMI hosts automatically.

Gossamer solves a common homelab pain point: manually rotating TLS certificates
on TrueNAS storage servers and Supermicro IPMI BMCs. It supports pushing certs
via the TrueNAS REST API and driving the Supermicro BMC web UI with a headless
browser (Playwright).

```
                         +-------------------+
                         |  Certificate      |
                         |  Source           |
                         |  (file or K8s)    |
                         +---------+---------+
                                   |
                                   v
                         +-------------------+
                         |    Gossamer       |
                         |                   |
                         |  - reads cert/key |
                         |  - converts key   |
                         |    to PKCS#8      |
                         +---------+---------+
                                   |
                    +--------------+--------------+
                    |                             |
                    v                             v
          +------------------+          +------------------+
          |  TrueNAS hosts   |          |  IPMI BMCs       |
          |                  |          |                  |
          |  REST API        |          |  Headless        |
          |  - import cert   |          |  browser         |
          |  - activate      |          |  - login         |
          |  - cleanup old   |          |  - upload cert   |
          |                  |          |  - reset BMC     |
          +------------------+          +------------------+
```

## Supported Targets

- **TrueNAS SCALE/CORE** -- REST API (`/api/v2.0/certificate`)
- **Supermicro IPMI** -- Headless browser automation (ATEN-based BMC web UI)

## Quick Start

```bash
docker run --rm \
  -v /path/to/cert.pem:/certs/tls.crt:ro \
  -v /path/to/key.pem:/certs/tls.key:ro \
  -v /path/to/targets.json:/config/targets.json:ro \
  -e TRUENAS_NAS1_TOKEN=your-api-token \
  -e IPMI_USERNAME=admin \
  -e IPMI_PASSWORD=yourpassword \
  ghcr.io/venezia/gossamer:latest \
    --cert /certs/tls.crt \
    --key /certs/tls.key \
    --config /config/targets.json
```

## Configuration

See [docs/configuration.md](docs/configuration.md) for full details on
targets, credentials, and all available options.

## Kubernetes Deployment

A Helm chart is available for running Gossamer as a CronJob that
automatically reads certificates from a Kubernetes Secret (e.g., one
managed by cert-manager).

See [docs/kubernetes.md](docs/kubernetes.md) for installation and
configuration.

## How It Works

See [docs/how-it-works.md](docs/how-it-works.md) for details on the
TrueNAS API integration and Supermicro IPMI browser automation.

## Key Features

- **Idempotent** -- safe to run repeatedly; re-imports the same cert without harm
- **Continue on failure** -- if one target fails, the rest still get updated
- **Automatic cleanup** -- removes old certificates from TrueNAS after import
- **PKCS#8 conversion** -- automatically converts RSA keys to the format IPMI requires
- **Non-zero exit** -- exits with code 1 if any target fails, for alerting in CI/cron

## License

Apache License 2.0
