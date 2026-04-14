const https = require("https");

/**
 * Make an HTTPS request to the TrueNAS API.
 * Ignores self-signed certificate errors.
 */
function apiRequest(host, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: host,
      port: 443,
      path,
      method,
      rejectAuthorized: false,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // Trust self-signed certs (the cert we're replacing may be expired)
      agent: new https.Agent({ rejectUnauthorized: false }),
    };

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`TrueNAS API ${method} ${path}: HTTP ${res.statusCode} - ${data}`));
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Wait for an async TrueNAS job to complete.
 */
async function waitForJob(host, token, jobId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const jobs = await apiRequest(host, "GET", `/api/v2.0/core/get_jobs?id=${jobId}`, token);
    if (Array.isArray(jobs) && jobs.length > 0) {
      const job = jobs[0];
      if (job.state === "SUCCESS") return job.result;
      if (job.state === "FAILED") throw new Error(`Job ${jobId} failed: ${job.error}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
}

/**
 * Push a TLS certificate to a TrueNAS host.
 *
 * Imports the cert, sets it as the active UI certificate,
 * restarts the web UI, and cleans up old wildcard certs.
 */
async function pushCert(host, token, certPem, keyPem) {
  const dateSuffix = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const certName = `gossamer-${dateSuffix}`;

  // Import certificate
  console.log(`  [${host}] Importing certificate as "${certName}"...`);
  const jobId = await apiRequest(host, "POST", "/api/v2.0/certificate", token, {
    name: certName,
    create_type: "CERTIFICATE_CREATE_IMPORTED",
    certificate: certPem,
    privatekey: keyPem,
  });

  const certResult = await waitForJob(host, token, jobId);
  const newCertId = certResult.id;
  console.log(`  [${host}] Imported certificate ID: ${newCertId}`);

  // Set as active UI certificate
  await apiRequest(host, "PUT", "/api/v2.0/system/general", token, {
    ui_certificate: newCertId,
  });
  console.log(`  [${host}] Set as active UI certificate`);

  // Restart web UI
  await apiRequest(host, "POST", "/api/v2.0/system/general/ui_restart", token);
  console.log(`  [${host}] UI restart triggered`);

  // Wait for UI to come back
  console.log(`  [${host}] Waiting for UI to restart...`);
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      await apiRequest(host, "GET", "/api/v2.0/system/general", token);
      break;
    } catch {
      if (i === 11) console.warn(`  [${host}] Warning: UI may still be restarting`);
    }
  }

  // Clean up old gossamer-* and quacks-wildcard-* certs
  const allCerts = await apiRequest(host, "GET", "/api/v2.0/certificate", token);
  for (const cert of allCerts) {
    const isOldGossamer = cert.name.startsWith("gossamer-") && cert.id !== newCertId;
    const isOldWildcard = cert.name.includes("quacks-wildcard") && cert.id !== newCertId;
    const isOldStarQuacks = cert.name.includes("star-quacks") && cert.id !== newCertId;
    if (isOldGossamer || isOldWildcard || isOldStarQuacks) {
      console.log(`  [${host}] Deleting old cert: ${cert.name} (ID ${cert.id})`);
      await apiRequest(host, "DELETE", `/api/v2.0/certificate/id/${cert.id}`, token).catch(
        (err) => console.warn(`  [${host}] Warning: failed to delete cert ${cert.id}: ${err.message}`)
      );
    }
  }

  console.log(`  [${host}] Done`);
}

module.exports = { pushCert };
