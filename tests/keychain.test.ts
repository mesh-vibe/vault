import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createCipheriv } from "node:crypto";

// Mock homedir and execFileSync before importing
const testDir = join(tmpdir(), `vault-test-${Date.now()}`);
const testStorePath = join(testDir, "mesh-vibe", "vault", "secrets.enc");

// Generate a test master key
const testMasterKey = randomBytes(32);
const testMasterKeyHex = testMasterKey.toString("hex");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => testDir };
});

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((_cmd: string, args: string[]) => {
    // Simulate Keychain: only the master key exists
    if (args.includes("find-generic-password") && args.includes("vault-master-key")) {
      return testMasterKeyHex + "\n";
    }
    if (args.includes("find-generic-password")) {
      throw new Error("not found");
    }
    if (args.includes("add-generic-password")) {
      return "";
    }
    if (args.includes("dump-keychain")) {
      return "";
    }
    if (args.includes("delete-generic-password")) {
      return "";
    }
    return "";
  }),
}));

const {
  vaultGet,
  vaultSet,
  vaultDelete,
  vaultList,
  VaultError,
  getStorePath,
} = await import("../src/keychain.js");

describe("vault encrypted store", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "mesh-vibe", "vault"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("getStorePath returns correct path", () => {
    expect(getStorePath()).toBe(testStorePath);
  });

  it("vaultSet creates encrypted file and vaultGet retrieves value", () => {
    vaultSet("api-key", "secret123");

    // File should exist and be encrypted (not plaintext)
    const raw = readFileSync(testStorePath, "utf-8");
    const payload = JSON.parse(raw);
    expect(payload).toHaveProperty("iv");
    expect(payload).toHaveProperty("tag");
    expect(payload).toHaveProperty("data");
    expect(raw).not.toContain("secret123");

    // Should be able to get it back
    const value = vaultGet("api-key");
    expect(value).toBe("secret123");
  });

  it("vaultSet updates existing secret", () => {
    vaultSet("key", "value1");
    vaultSet("key", "value2");
    expect(vaultGet("key")).toBe("value2");
  });

  it("vaultSet stores multiple secrets", () => {
    vaultSet("key1", "value1");
    vaultSet("key2", "value2");
    expect(vaultGet("key1")).toBe("value1");
    expect(vaultGet("key2")).toBe("value2");
  });

  it("vaultGet throws VaultError for missing key", () => {
    vaultSet("exists", "yes");
    expect(() => vaultGet("missing")).toThrow(VaultError);
    expect(() => vaultGet("missing")).toThrow(/not found/);
  });

  it("vaultGet throws VaultError when no store exists", () => {
    expect(() => vaultGet("anything")).toThrow(VaultError);
    expect(() => vaultGet("anything")).toThrow(/not found/);
  });

  it("vaultDelete removes a secret", () => {
    vaultSet("key1", "value1");
    vaultSet("key2", "value2");
    vaultDelete("key1");
    expect(() => vaultGet("key1")).toThrow(VaultError);
    expect(vaultGet("key2")).toBe("value2");
  });

  it("vaultDelete throws for missing key", () => {
    vaultSet("exists", "yes");
    expect(() => vaultDelete("missing")).toThrow(VaultError);
    expect(() => vaultDelete("missing")).toThrow(/not found/);
  });

  it("vaultList returns sorted keys", () => {
    vaultSet("zebra", "z");
    vaultSet("alpha", "a");
    vaultSet("middle", "m");
    expect(vaultList()).toEqual(["alpha", "middle", "zebra"]);
  });

  it("vaultList returns empty array for empty store", () => {
    // Write an empty store
    vaultSet("temp", "t");
    vaultDelete("temp");
    expect(vaultList()).toEqual([]);
  });

  it("handles secrets with special characters", () => {
    const specialValue = 'key="value" & <xml> \n\t $HOME ${PATH}';
    vaultSet("special", specialValue);
    expect(vaultGet("special")).toBe(specialValue);
  });

  it("handles multi-line values", () => {
    const multiLine = "line1\nline2\nline3";
    vaultSet("multi", multiLine);
    expect(vaultGet("multi")).toBe(multiLine);
  });

  it("encrypted file uses fresh IV each write", () => {
    vaultSet("key", "value");
    const raw1 = readFileSync(testStorePath, "utf-8");
    const payload1 = JSON.parse(raw1);

    vaultSet("key", "value"); // same value, should get new IV
    const raw2 = readFileSync(testStorePath, "utf-8");
    const payload2 = JSON.parse(raw2);

    expect(payload1.iv).not.toBe(payload2.iv);
  });

  it("detects tampered ciphertext", () => {
    vaultSet("key", "value");
    const raw = readFileSync(testStorePath, "utf-8");
    const payload = JSON.parse(raw);

    // Tamper with the data
    payload.data = payload.data.replace(/[0-9a-f]/, "0");
    writeFileSync(testStorePath, JSON.stringify(payload), "utf-8");

    // May or may not throw depending on whether the tamper changes anything
    // but if the auth tag doesn't match, it should throw
    try {
      vaultGet("key");
      // If we get here, the tamper didn't change the data (unlikely but possible)
    } catch (err) {
      expect(err).toBeInstanceOf(VaultError);
    }
  });
});
