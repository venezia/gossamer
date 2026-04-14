const https = require("https");
const fs = require("fs");
const path = require("path");

const SA_TOKEN_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SA_CA_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

/**
 * Fetch a TLS secret from the Kubernetes API and write cert/key to disk.
 *
 * Uses the pod's mounted service account token for authentication.
 * Requires RBAC granting get access to the target secret.
 */
async function fetchSecret(namespace, secretName, outputDir) {
  if (!fs.existsSync(SA_TOKEN_PATH)) {
    throw new Error(
      `Service account token not found at ${SA_TOKEN_PATH}. ` +
        "Are you running inside a Kubernetes pod?"
    );
  }

  const token = fs.readFileSync(SA_TOKEN_PATH, "utf8").trim();
  const ca = fs.readFileSync(SA_CA_PATH);

  const data = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "kubernetes.default.svc",
        port: 443,
        path: `/api/v1/namespaces/${namespace}/secrets/${secretName}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        ca,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Failed to fetch secret ${namespace}/${secretName}: HTTP ${res.statusCode} - ${body}`
              )
            );
            return;
          }
          resolve(JSON.parse(body));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });

  const certB64 = data.data["tls.crt"];
  const keyB64 = data.data["tls.key"];

  if (!certB64 || !keyB64) {
    throw new Error(
      `Secret ${namespace}/${secretName} missing tls.crt or tls.key`
    );
  }

  const certPath = path.join(outputDir, "tls.crt");
  const keyPath = path.join(outputDir, "tls.key");

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(certPath, Buffer.from(certB64, "base64"));
  fs.writeFileSync(keyPath, Buffer.from(keyB64, "base64"), { mode: 0o600 });

  console.log(`Fetched secret ${namespace}/${secretName} -> ${outputDir}`);
  return { certPath, keyPath };
}

module.exports = { fetchSecret };
