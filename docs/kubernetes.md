# Kubernetes Deployment

Gossamer includes a Helm chart for deploying as a CronJob that automatically
reads TLS certificates from a Kubernetes Secret.

## Architecture

```
  +------------------+        +---------------------+
  |  cert-manager    |        |  gossamer CronJob   |
  |                  |        |  (weekly)           |
  |  Renews wildcard |        |                     |
  |  cert every      +------->  1. Reads TLS secret |
  |  ~60 days        |  RBAC  |  2. Pushes to all   |
  |                  |        |     targets          |
  +------------------+        +----------+----------+
                                         |
                    +--------------------+--------------------+
                    |                    |                    |
                    v                    v                    v
             +-----------+        +-----------+        +-----------+
             | TrueNAS 1 |        | TrueNAS 2 |        | IPMI 1    |
             | (API)     |        | (API)     |        | (browser) |
             +-----------+        +-----------+        +-----------+
```

## Installation

### From OCI Registry

```bash
helm install gossamer oci://ghcr.io/venezia/gossamer \
  --namespace cert-push --create-namespace \
  --values values.yaml
```

### Example values.yaml

```yaml
image:
  repository: ghcr.io/venezia/gossamer
  tag: v0.1.3

schedule: "0 3 * * 1"  # Weekly, Monday 3 AM

tlsSecret:
  fetchFromCluster: true
  namespace: istio-ingress   # Where cert-manager stores the cert
  name: wildcard-tls         # The TLS secret name

targets:
- host: nas1.example.com
  type: truenas
  tokenEnv: TRUENAS_NAS1_TOKEN
- host: nas2.example.com
  type: truenas
  tokenEnv: TRUENAS_NAS2_TOKEN
- host: nas1-ipmi.example.com
  type: ipmi
  usernameEnv: IPMI_USERNAME
  passwordEnv: IPMI_PASSWORD

credentials:
  truenasTokens:
    TRUENAS_NAS1_TOKEN: "your-nas1-api-token"
    TRUENAS_NAS2_TOKEN: "your-nas2-api-token"
  ipmiCredentials:
    IPMI_USERNAME: "admin"
    IPMI_PASSWORD: "yourpassword"
```

## What the Chart Creates

| Resource | Description |
|----------|-------------|
| CronJob | Runs gossamer on the configured schedule |
| ServiceAccount | Identity for the gossamer pod |
| Role (in TLS secret namespace) | Grants `get` on the specific TLS secret |
| RoleBinding (in TLS secret namespace) | Binds the ServiceAccount to the Role |
| ConfigMap | Targets configuration |
| Secret (truenas) | TrueNAS API tokens |
| Secret (ipmi) | IPMI credentials |

## RBAC

The chart creates a Role and RoleBinding in the TLS secret's namespace
(not the gossamer namespace). This grants the gossamer ServiceAccount
read access to that one specific secret -- nothing else.

```
  cert-push namespace          istio-ingress namespace
  +--------------------+       +-------------------------+
  | ServiceAccount     |       | Role                    |
  |   gossamer         +------>|   get secret/wildcard   |
  +--------------------+       +-------------------------+
                               | RoleBinding             |
                               |   gossamer -> Role      |
                               +-------------------------+
```

## Using with ArgoCD

For GitOps deployments, use the wrapper chart pattern:

1. Pull the gossamer chart into your repo:
   ```bash
   helm pull oci://ghcr.io/venezia/gossamer --version 0.1.3 -d charts/
   ```

2. Create a `Chart.yaml`:
   ```yaml
   apiVersion: v2
   name: cert-push-wrapper
   version: 0.1.0
   dependencies:
     - name: gossamer
       version: 0.1.3
       repository: oci://ghcr.io/venezia
   ```

3. Create a `values.sops.yaml` with your encrypted credentials

4. Deploy via ArgoCD Application pointing to this directory

## Manual Test Run

Trigger the CronJob immediately without waiting for the schedule:

```bash
kubectl create job --from=cronjob/gossamer cert-push-test -n cert-push
kubectl logs -n cert-push -f job/cert-push-test
```

## Scheduling

The default schedule is `0 3 * * 1` (Monday 3 AM). With Let's Encrypt
certificates (90-day lifetime, renewed at day 60 by cert-manager),
a weekly push means targets are updated within 7 days of renewal --
leaving at least 23 days of validity.

For tighter windows, use a daily schedule: `0 3 * * *`. The job is
idempotent, so daily runs when the cert hasn't changed simply
re-import the same certificate.
