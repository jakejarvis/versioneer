import { decodeCBOR } from "@levischuck/tiny-cbor";
import { AsnParser, AsnSerializer } from "@peculiar/asn1-schema";
import { Certificate } from "@peculiar/asn1-x509";

import { APPLE_APP_ATTESTATION_ROOT_CA_PEM } from "./apple-root-ca";

const TEAM_ID = "B5ZWKBCUTU";
const BUNDLE_ID = "com.jakejarvis.versioneer";
const APP_ID = `${TEAM_ID}.${BUNDLE_ID}`;

// Apple App Attest nonce extension OID: 1.2.840.113635.100.8.2
const NONCE_EXTENSION_OID = "1.2.840.113635.100.8.2";

const DEVELOPMENT_AAGUID_HEX = "617070617474657374646576656c6f70";
const PRODUCTION_AAGUID_HEX = "00000000000000000000000000000000";

// ── Helpers ──────────────────────────────────────────────────────────────────

let rpIdHashCache: ArrayBuffer | null = null;

async function getRpIdHash(): Promise<ArrayBuffer> {
  if (rpIdHashCache) return rpIdHashCache;
  rpIdHashCache = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(APP_ID));
  return rpIdHashCache;
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s/g, "");
  return base64ToBytes(b64);
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── X.509 helpers using @peculiar/asn1-x509 ─────────────────────────────────

function parseCert(der: Uint8Array): Certificate {
  return AsnParser.parse(der, Certificate);
}

/** Get the DER-encoded TBSCertificate (the signed payload). */
function getTBS(cert: Certificate): ArrayBuffer {
  return AsnSerializer.serialize(cert.tbsCertificate);
}

/** Get the DER-encoded SubjectPublicKeyInfo. */
function getSPKI(cert: Certificate): ArrayBuffer {
  return AsnSerializer.serialize(cert.tbsCertificate.subjectPublicKeyInfo);
}

/** Get the raw X9.62 uncompressed EC point (0x04 || X || Y) from a certificate. */
function getRawPublicKey(cert: Certificate): Uint8Array {
  return new Uint8Array(cert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey);
}

/** Get the raw signature bytes from the certificate's BIT STRING. */
function getSignatureBytes(cert: Certificate): Uint8Array {
  return new Uint8Array(cert.signatureValue);
}

/** Find an extension by OID and return its raw value. */
function findExtension(cert: Certificate, oid: string): Uint8Array | null {
  const exts = cert.tbsCertificate.extensions;
  if (!exts) return null;
  for (const ext of exts) {
    if (ext.extnID === oid) {
      return new Uint8Array(ext.extnValue.buffer);
    }
  }
  return null;
}

/**
 * Extract the nonce from Apple's custom attestation extension.
 * The extension value wraps the nonce in: SEQUENCE { SEQUENCE { INTEGER, OCTET STRING(nonce) } }
 * We parse the outer structure with AsnParser to get the raw OCTET STRING.
 */
function extractNonceFromExtension(extValue: Uint8Array): Uint8Array {
  // The extension value is an ASN.1 structure. We need the innermost OCTET STRING.
  // Scan for the last 0x04 (OCTET STRING) tag — the nonce is always 32 bytes (SHA-256).
  for (let i = extValue.length - 33; i >= 0; i--) {
    if (extValue[i] === 0x04 && extValue[i + 1] === 0x20) {
      return extValue.slice(i + 2, i + 2 + 32);
    }
  }
  throw new Error("Nonce OCTET STRING not found in extension");
}

/** Import an EC P-256 public key from DER-encoded SPKI for WebCrypto verification. */
async function importSPKIKey(spkiDer: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", spkiDer, { name: "ECDSA", namedCurve: "P-256" }, true, [
    "verify",
  ]);
}

/** Determine the hash algorithm used by a certificate's signature. */
function getSignatureHash(cert: Certificate): string {
  const oid = cert.signatureAlgorithm.algorithm;
  switch (oid) {
    // ecdsa-with-SHA256
    case "1.2.840.10045.4.3.2":
      return "SHA-256";
    // ecdsa-with-SHA384
    case "1.2.840.10045.4.3.3":
      return "SHA-384";
    default:
      throw new Error(`Unsupported signature algorithm OID: ${oid}`);
  }
}

// ── Certificate chain verification ───────────────────────────────────────────

let rootCertCache: Certificate | null = null;

function getRootCert(): Certificate {
  if (rootCertCache) return rootCertCache;
  rootCertCache = parseCert(pemToBytes(APPLE_APP_ATTESTATION_ROOT_CA_PEM));
  return rootCertCache;
}

/** Verify a certificate's notBefore/notAfter validity period. */
function checkCertValidity(cert: Certificate, label: string): void {
  const now = new Date();
  const notBefore = cert.tbsCertificate.validity.notBefore.getTime();
  const notAfter = cert.tbsCertificate.validity.notAfter.getTime();
  if (now < notBefore) {
    throw new Error(`${label} certificate is not yet valid`);
  }
  if (now > notAfter) {
    throw new Error(`${label} certificate has expired`);
  }
}

/**
 * Verify the x5c certificate chain and return the parsed leaf certificate.
 * Chain: [leaf, intermediate] — intermediate must be signed by the Apple root CA.
 */
async function verifyCertChain(x5c: Uint8Array[]): Promise<Certificate> {
  if (x5c.length < 2) {
    throw new Error("x5c chain must contain at least 2 certificates");
  }

  const rootCert = getRootCert();
  const intermediateCert = parseCert(x5c[1]!);
  const leafCert = parseCert(x5c[0]!);

  checkCertValidity(intermediateCert, "Intermediate");
  checkCertValidity(leafCert, "Leaf");

  // Verify intermediate is signed by root
  const rootKey = await importSPKIKey(getSPKI(rootCert));
  const intermediateValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: getSignatureHash(intermediateCert) },
    rootKey,
    copyToArrayBuffer(getSignatureBytes(intermediateCert)),
    getTBS(intermediateCert),
  );
  if (!intermediateValid) {
    throw new Error("Intermediate certificate not signed by Apple root CA");
  }

  // Verify leaf is signed by intermediate
  const intermediateKey = await importSPKIKey(getSPKI(intermediateCert));
  const leafValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: getSignatureHash(leafCert) },
    intermediateKey,
    copyToArrayBuffer(getSignatureBytes(leafCert)),
    getTBS(leafCert),
  );
  if (!leafValid) {
    throw new Error("Leaf certificate not signed by intermediate CA");
  }

  return leafCert;
}

// ── Authenticator data parsing ───────────────────────────────────────────────

interface ParsedAuthData {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  aaguid: Uint8Array | null;
  credentialId: Uint8Array | null;
  raw: Uint8Array;
}

function parseAuthenticatorData(data: Uint8Array): ParsedAuthData {
  if (data.length < 37) throw new Error("Authenticator data too short");

  const rpIdHash = data.slice(0, 32);
  const flags = data[32]!;
  const counter = new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0, false);

  const hasAttestedCredData = (flags & 0x40) !== 0;
  let aaguid: Uint8Array | null = null;
  let credentialId: Uint8Array | null = null;

  if (hasAttestedCredData && data.length > 37) {
    let offset = 37;
    aaguid = data.slice(offset, offset + 16);
    offset += 16;

    const credIdLen = new DataView(data.buffer, data.byteOffset + offset, 2).getUint16(0, false);
    offset += 2;

    credentialId = data.slice(offset, offset + credIdLen);
  }

  return { rpIdHash, flags, counter, aaguid, credentialId, raw: data };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface AttestationResult {
  publicKey: string; // base64 SPKI
  receipt: string; // base64
  counter: number;
  environment: "development" | "production";
}

/**
 * Verify an App Attest attestation object.
 * https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
 */
export async function verifyAttestation(
  attestationB64: string,
  keyId: string,
  challenge: string,
): Promise<AttestationResult> {
  const attestationBytes = base64ToBytes(attestationB64);
  const decoded = decodeCBOR(attestationBytes);
  const attestObj = decoded as unknown as {
    fmt: string;
    attStmt: { x5c: Uint8Array[]; receipt: Uint8Array };
    authData: Uint8Array;
  };

  if (attestObj.fmt !== "apple-appattest") {
    throw new Error(`Unexpected attestation format: ${attestObj.fmt}`);
  }

  const { x5c, receipt } = attestObj.attStmt;
  const authData = attestObj.authData;

  // 1. Verify the x5c certificate chain against Apple root CA
  const leafCert = await verifyCertChain(x5c);

  // 2. Compute expected nonce: SHA-256(authData || SHA-256(challenge))
  const challengeHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challenge));
  const composite = new Uint8Array(authData.length + 32);
  composite.set(authData, 0);
  composite.set(new Uint8Array(challengeHash), authData.length);
  const expectedNonce = new Uint8Array(await crypto.subtle.digest("SHA-256", composite));

  // 3. Verify nonce in leaf certificate extension matches
  const nonceExt = findExtension(leafCert, NONCE_EXTENSION_OID);
  if (!nonceExt) throw new Error("Nonce extension not found in leaf cert");
  const certNonce = extractNonceFromExtension(nonceExt);
  if (!arraysEqual(certNonce, expectedNonce)) {
    throw new Error("Attestation nonce mismatch");
  }

  // 4. Verify the public key hash matches the keyId (X9.62 uncompressed point, per Apple docs)
  const rawPublicKey = getRawPublicKey(leafCert);
  const keyHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copyToArrayBuffer(rawPublicKey)),
  );
  const keyIdBytes = base64ToBytes(keyId);
  if (!arraysEqual(keyHash, keyIdBytes)) {
    throw new Error("Public key hash does not match keyId");
  }

  // 5. Parse and validate authenticator data
  const parsed = parseAuthenticatorData(authData);

  // 5a. Verify credentialId matches keyId
  if (!parsed.credentialId || !arraysEqual(parsed.credentialId, keyIdBytes)) {
    throw new Error("Authenticator data credentialId does not match keyId");
  }

  const expectedRpIdHash = new Uint8Array(await getRpIdHash());
  if (!arraysEqual(parsed.rpIdHash, expectedRpIdHash)) {
    throw new Error("RP ID hash mismatch");
  }

  if (parsed.counter !== 0) {
    throw new Error(`Expected counter 0 for attestation, got ${parsed.counter}`);
  }

  // 6. Check AAGUID to determine environment
  const aaguidHex = parsed.aaguid ? toHex(parsed.aaguid) : "";
  let environment: "development" | "production";
  if (aaguidHex === DEVELOPMENT_AAGUID_HEX) {
    environment = "development";
  } else if (aaguidHex === PRODUCTION_AAGUID_HEX) {
    environment = "production";
  } else {
    throw new Error(`Unexpected AAGUID: ${aaguidHex}`);
  }

  // Store SPKI for later assertion verification via crypto.subtle.importKey("spki", ...)
  const leafSPKI = getSPKI(leafCert);

  return {
    publicKey: bytesToBase64(new Uint8Array(leafSPKI)),
    receipt: bytesToBase64(new Uint8Array(receipt)),
    counter: parsed.counter,
    environment,
  };
}

export interface AssertionResult {
  newCounter: number;
}

/**
 * Verify an App Attest assertion.
 * https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
 */
export async function verifyAssertion(
  assertionB64: string,
  challenge: string,
  storedPublicKeyB64: string,
  storedCounter: number,
): Promise<AssertionResult> {
  const assertionBytes = base64ToBytes(assertionB64);
  const decoded = decodeCBOR(assertionBytes);
  const assertionObj = decoded as unknown as {
    signature: Uint8Array;
    authenticatorData: Uint8Array;
  };

  const { signature, authenticatorData } = assertionObj;
  const parsed = parseAuthenticatorData(authenticatorData);

  // 1. Verify RP ID hash
  const expectedRpIdHash = new Uint8Array(await getRpIdHash());
  if (!arraysEqual(parsed.rpIdHash, expectedRpIdHash)) {
    throw new Error("RP ID hash mismatch");
  }

  // 2. Verify counter monotonicity
  if (parsed.counter <= storedCounter) {
    throw new Error(`Counter not monotonic: got ${parsed.counter}, expected > ${storedCounter}`);
  }

  // 3. Construct the verification input: authenticatorData || SHA-256(challenge)
  // WebCrypto's ECDSA verify with hash:"SHA-256" will SHA-256 this before checking,
  // matching the Secure Enclave's signature over SHA-256(authenticatorData || clientDataHash).
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challenge)),
  );
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData, 0);
  signedData.set(clientDataHash, authenticatorData.length);

  // 4. Verify ECDSA signature with stored public key
  const spkiBytes = base64ToBytes(storedPublicKeyB64);
  const spkiBuffer = new ArrayBuffer(spkiBytes.byteLength);
  new Uint8Array(spkiBuffer).set(spkiBytes);
  const publicKey = await importSPKIKey(spkiBuffer);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    copyToArrayBuffer(signature),
    copyToArrayBuffer(signedData),
  );
  if (!valid) {
    throw new Error("Assertion signature verification failed");
  }

  return { newCounter: parsed.counter };
}
