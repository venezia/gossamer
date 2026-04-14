const crypto = require("crypto");

/**
 * Convert a PEM private key to PKCS#8 format.
 * If already PKCS#8, returns the input unchanged.
 *
 * Supermicro IPMI and some TrueNAS versions require PKCS#8
 * ("BEGIN PRIVATE KEY") rather than PKCS#1 ("BEGIN RSA PRIVATE KEY").
 */
function toPkcs8(keyPem) {
  const keyObj = crypto.createPrivateKey(keyPem);
  return keyObj.export({ type: "pkcs8", format: "pem" });
}

module.exports = { toPkcs8 };
