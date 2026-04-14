const { chromium } = require("playwright");
const fs = require("fs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a Supermicro BMC to come back online after SSL reset.
 */
async function waitForBmc(host, timeoutSec = 120) {
  const url = `https://${host}`;
  const attempts = Math.ceil(timeoutSec / 10);
  for (let i = 0; i < attempts; i++) {
    await sleep(10000);
    try {
      const browser = await chromium.launch({
        headless: true,
        args: ["--ignore-certificate-errors", "--no-sandbox", "--disable-dev-shm-usage"],
      });
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      await page.goto(url, { timeout: 10000 });
      await browser.close();
      return true;
    } catch {
      console.log(`  [${host}] Attempt ${i + 1}/${attempts} - BMC not ready yet...`);
    }
  }
  return false;
}

/**
 * Push a TLS certificate to a Supermicro IPMI BMC via headless browser.
 *
 * Logs in, navigates to the SSL Certification page inside the BMC's
 * frameset, uploads the cert and key files, and triggers an SSL reset.
 */
async function pushCert(host, username, password, certPath, keyPath) {
  const url = `https://${host}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Auto-accept any JS alert/confirm dialogs
  page.on("dialog", async (dialog) => {
    console.log(`  [${host}] Dialog: ${dialog.type()} - "${dialog.message()}"`);
    await dialog.accept();
  });

  // Login
  console.log(`  [${host}] Logging in...`);
  await page.goto(url);
  await page.fill('input[name="name"]', username);
  await page.fill('input[name="pwd"]', password);
  await page.click('input[type="submit"], #login_word');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  // Find the MainFrame in the BMC's frameset
  let contentFrame = null;
  for (const f of page.frames()) {
    const name = f.name();
    if (name === "MainFrame" || name === "main" || name === "mainFrame" || name === "content") {
      contentFrame = f;
      break;
    }
  }
  if (!contentFrame) {
    for (const f of page.frames()) {
      if (f !== page.mainFrame() && f.url() !== "about:blank") {
        contentFrame = f;
      }
    }
  }

  if (!contentFrame) {
    await browser.close();
    throw new Error("Could not find content frame in BMC UI");
  }

  // Navigate to SSL configuration
  console.log(`  [${host}] Navigating to SSL configuration...`);
  await contentFrame.goto(`${url}/cgi/url_redirect.cgi?url_name=config_ssl`);
  await contentFrame.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // Verify file inputs exist
  const inputs = await contentFrame.locator('input[type="file"]').count();
  if (inputs < 2) {
    await browser.close();
    throw new Error(`Expected 2 file inputs on SSL page, found ${inputs}`);
  }

  // Wait for BMC's PageInit() JS to set the NAME attributes
  await contentFrame
    .waitForFunction(() => {
      const el = document.getElementById("sslcrt_file");
      return el && el.name && el.name.includes("/etc/");
    }, { timeout: 5000 })
    .catch(() => {});

  // Copy cert/key with .pem extension (BMC requires .pem or .cert)
  const tmpCert = "/tmp/gossamer-cert.pem";
  const tmpKey = "/tmp/gossamer-key.pem";
  fs.copyFileSync(certPath, tmpCert);
  fs.copyFileSync(keyPath, tmpKey);

  // Upload cert and key
  console.log(`  [${host}] Uploading certificate and key...`);
  await contentFrame.locator("#sslcrt_file").setInputFiles(tmpCert);
  await contentFrame.locator("#privkey_file").setInputFiles(tmpKey);

  // Click upload
  await contentFrame.locator("#ButtonUpload").click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  // Handle any confirmation dialog
  for (const selector of [
    ".ui-dialog-buttonset button:first-child",
    "button:has-text('OK')",
    "button:has-text('Yes')",
    ".ui-dialog button",
  ]) {
    try {
      const btn = contentFrame.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        break;
      }
    } catch {
      continue;
    }
  }

  // Always trigger the reset endpoint to ensure BMC applies the cert
  console.log(`  [${host}] Triggering BMC SSL reset...`);
  await contentFrame.goto(`${url}/cgi/url_redirect.cgi?url_name=config_ssl_fw_reset`);
  await page.waitForTimeout(2000);

  await browser.close();

  // Wait for BMC to come back
  console.log(`  [${host}] Waiting for BMC to reboot...`);
  const ok = await waitForBmc(host);
  if (!ok) {
    throw new Error(`BMC did not come back online within timeout`);
  }
  console.log(`  [${host}] Done`);
}

module.exports = { pushCert };
