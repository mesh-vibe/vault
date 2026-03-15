import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SECURITY = "/usr/bin/security";
const MASTER_KEY_SERVICE = "vault-master-key";
const MASTER_KEY_ACCOUNT = "vault";
const TIMEOUT = 5_000;
const ALGORITHM = "aes-256-gcm";

export function getStorePath(): string {
  return join(homedir(), "mesh-vibe", "vault", "secrets.enc");
}

export class VaultError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "VaultError";
  }
}

// --- Master key (single Keychain entry) ---

function getMasterKey(): Buffer {
  try {
    const hex = execFileSync(
      SECURITY,
      ["find-generic-password", "-a", MASTER_KEY_ACCOUNT, "-s", MASTER_KEY_SERVICE, "-w"],
      { encoding: "utf-8", timeout: TIMEOUT },
    ).trim();
    return Buffer.from(hex, "hex");
  } catch (err) {
    throw new VaultError(
      "Master key not found in Keychain. Run 'vault migrate' or 'vault init-store' first.",
      err as Error,
    );
  }
}

function storeMasterKey(key: Buffer): void {
  try {
    execFileSync(
      SECURITY,
      [
        "add-generic-password",
        "-a", MASTER_KEY_ACCOUNT,
        "-s", MASTER_KEY_SERVICE,
        "-w", key.toString("hex"),
        "-U",
      ],
      { encoding: "utf-8", timeout: TIMEOUT },
    );
  } catch (err) {
    throw new VaultError("Failed to store master key in Keychain", err as Error);
  }
}

function masterKeyExists(): boolean {
  try {
    execFileSync(
      SECURITY,
      ["find-generic-password", "-a", MASTER_KEY_ACCOUNT, "-s", MASTER_KEY_SERVICE, "-w"],
      { encoding: "utf-8", timeout: TIMEOUT },
    );
    return true;
  } catch {
    return false;
  }
}

// --- AES-256-GCM encryption ---

interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

// --- Encrypted store read/write ---

function loadSecrets(key: Buffer): Record<string, string> {
  const storePath = getStorePath();
  if (!existsSync(storePath)) return {};

  try {
    const raw = readFileSync(storePath, "utf-8");
    const payload: EncryptedPayload = JSON.parse(raw);
    const plaintext = decrypt(payload, key);
    return JSON.parse(plaintext);
  } catch (err) {
    throw new VaultError("Failed to decrypt vault store", err as Error);
  }
}

function saveSecrets(secrets: Record<string, string>, key: Buffer): void {
  const storePath = getStorePath();
  const dir = join(storePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const plaintext = JSON.stringify(secrets, null, 2);
  const payload = encrypt(plaintext, key);
  writeFileSync(storePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

// --- Public API ---

export function vaultGet(key: string): string {
  const masterKey = getMasterKey();
  const secrets = loadSecrets(masterKey);
  if (!(key in secrets)) {
    throw new VaultError(`Failed to get secret "${key}": not found`);
  }
  return secrets[key];
}

export function vaultSet(key: string, value: string): void {
  const masterKey = getMasterKey();
  const secrets = loadSecrets(masterKey);
  secrets[key] = value;
  saveSecrets(secrets, masterKey);
}

export function vaultDelete(key: string): void {
  const masterKey = getMasterKey();
  const secrets = loadSecrets(masterKey);
  if (!(key in secrets)) {
    throw new VaultError(`Failed to delete secret "${key}": not found`);
  }
  delete secrets[key];
  saveSecrets(secrets, masterKey);
}

export function vaultList(): string[] {
  const masterKey = getMasterKey();
  const secrets = loadSecrets(masterKey);
  return Object.keys(secrets).sort();
}

// --- Init & Migration ---

export function initStore(): void {
  if (masterKeyExists()) {
    throw new VaultError("Master key already exists. Use 'vault migrate' to import existing Keychain secrets.");
  }
  const key = randomBytes(32);
  storeMasterKey(key);
  saveSecrets({}, key);
}

export function migrateFromKeychain(): { migrated: string[]; errors: string[] } {
  const oldKeys = listOldKeychainEntries();

  let key: Buffer;
  if (masterKeyExists()) {
    key = getMasterKey();
  } else {
    key = randomBytes(32);
    storeMasterKey(key);
  }

  const secrets = loadSecrets(key);
  const migrated: string[] = [];
  const errors: string[] = [];

  for (const oldKey of oldKeys) {
    try {
      const value = readOldKeychainEntry(oldKey);
      secrets[oldKey] = value;
      migrated.push(oldKey);
    } catch {
      errors.push(oldKey);
    }
  }

  saveSecrets(secrets, key);
  return { migrated, errors };
}

export function cleanupOldKeychainEntries(keys: string[]): { deleted: string[]; errors: string[] } {
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const key of keys) {
    try {
      execFileSync(
        SECURITY,
        ["delete-generic-password", "-a", "vault", "-s", key],
        { encoding: "utf-8", timeout: TIMEOUT },
      );
      deleted.push(key);
    } catch {
      errors.push(key);
    }
  }

  return { deleted, errors };
}

// --- Old Keychain helpers (migration only) ---

function listOldKeychainEntries(): string[] {
  try {
    const output = execFileSync(SECURITY, ["dump-keychain"], {
      encoding: "utf-8",
      timeout: TIMEOUT,
    });

    const keys: string[] = [];
    const lines = output.split("\n");
    let inVaultEntry = false;

    for (const line of lines) {
      const acctMatch = line.match(/^\s*"acct"<blob>="(.+)"$/);
      if (acctMatch) {
        inVaultEntry = acctMatch[1] === "vault";
        continue;
      }
      if (inVaultEntry) {
        const svcMatch = line.match(/^\s*"svce"<blob>="(.+)"$/);
        if (svcMatch) {
          if (svcMatch[1] !== MASTER_KEY_SERVICE) {
            keys.push(svcMatch[1]);
          }
          inVaultEntry = false;
        }
      }
    }

    return keys.sort();
  } catch {
    return [];
  }
}

function readOldKeychainEntry(key: string): string {
  return execFileSync(
    SECURITY,
    ["find-generic-password", "-a", "vault", "-s", key, "-w"],
    { encoding: "utf-8", timeout: TIMEOUT },
  ).trim();
}
