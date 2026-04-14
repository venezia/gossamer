#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const { toPkcs8 } = require("./convert-key");
const { fetchSecret } = require("./fetch-secret");
const truenas = require("./truenas");
const ipmi = require("./ipmi");

const { values: args } = parseArgs({
  options: {
    config: {
      type: "string",
      default: process.env.TARGETS_CONFIG || "/config/targets.json",
    },
    cert: { type: "string", default: process.env.CERT_PATH },
    key: { type: "string", default: process.env.KEY_PATH },
    "fetch-secret": {
      type: "boolean",
      default: process.env.FETCH_K8S_SECRET === "true",
    },
    "secret-namespace": {
      type: "string",
      default: process.env.SECRET_NAMESPACE || "istio-ingress",
    },
    "secret-name": {
      type: "string",
      default: process.env.SECRET_NAME || "quacks-org-tls",
    },
  },
});

async function main() {
  // Load cert and key — either from files or from K8s secret
  let certPath = args.cert;
  let keyPath = args.key;

  if (args["fetch-secret"]) {
    console.log(
      `Fetching secret ${args["secret-namespace"]}/${args["secret-name"]}...`
    );
    const result = await fetchSecret(
      args["secret-namespace"],
      args["secret-name"],
      "/certs"
    );
    certPath = result.certPath;
    keyPath = result.keyPath;
  }

  if (!certPath || !keyPath) {
    console.error(
      "Error: provide --cert and --key, or use --fetch-secret to read from Kubernetes"
    );
    process.exit(1);
  }

  if (!fs.existsSync(certPath)) {
    console.error(`Error: certificate file not found: ${certPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(keyPath)) {
    console.error(`Error: key file not found: ${keyPath}`);
    process.exit(1);
  }

  const certPem = fs.readFileSync(certPath, "utf8");
  const rawKeyPem = fs.readFileSync(keyPath, "utf8");
  const keyPem = toPkcs8(rawKeyPem);

  // Write the PKCS#8 key back for IPMI (Playwright needs a file path)
  const pkcs8KeyPath = path.join(path.dirname(keyPath), "tls-pkcs8.key");
  fs.writeFileSync(pkcs8KeyPath, keyPem, { mode: 0o600 });

  // Load targets config
  if (!fs.existsSync(args.config)) {
    console.error(`Error: config file not found: ${args.config}`);
    process.exit(1);
  }
  const targets = JSON.parse(fs.readFileSync(args.config, "utf8"));

  console.log(`Loaded ${targets.length} target(s) from ${args.config}`);
  console.log("");

  // Process each target
  const results = [];
  for (const target of targets) {
    const { host, type } = target;
    console.log(`[${host}] (${type})`);

    try {
      if (type === "truenas") {
        const token = process.env[target.tokenEnv];
        if (!token) {
          throw new Error(`Environment variable ${target.tokenEnv} not set`);
        }
        await truenas.pushCert(host, token, certPem, keyPem);
        results.push({ host, type, success: true });
      } else if (type === "ipmi") {
        const username = process.env[target.usernameEnv];
        const password = process.env[target.passwordEnv];
        if (!username || !password) {
          throw new Error(
            `Environment variables ${target.usernameEnv} and/or ${target.passwordEnv} not set`
          );
        }
        await ipmi.pushCert(host, username, password, certPath, pkcs8KeyPath);
        results.push({ host, type, success: true });
      } else {
        throw new Error(`Unknown target type: ${type}`);
      }
    } catch (err) {
      console.error(`  [${host}] FAILED: ${err.message}`);
      results.push({ host, type, success: false, error: err.message });
    }

    console.log("");
  }

  // Summary
  console.log("=".repeat(60));
  console.log("Summary:");
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);
  for (const r of results) {
    const status = r.success ? "OK" : "FAILED";
    console.log(`  ${status.padEnd(8)} ${r.type.padEnd(10)} ${r.host}`);
  }
  console.log(
    `\n${successes.length}/${results.length} succeeded, ${failures.length} failed`
  );

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
