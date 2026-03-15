#!/usr/bin/env node

import { Command } from "commander";
import {
  vaultGet,
  vaultSet,
  vaultDelete,
  vaultList,
  VaultError,
  initStore,
  migrateFromKeychain,
  cleanupOldKeychainEntries,
} from "./keychain.js";
import { installSkill } from "./templates/skill.md.js";

const program = new Command();

program
  .name("vault")
  .description("Encrypted secret store (AES-256-GCM, master key in macOS Keychain)")
  .version("0.2.0");

program
  .command("set <key> <value>")
  .description("Store or update a secret")
  .action((key: string, value: string) => {
    try {
      vaultSet(key, value);
      console.log(`Stored: ${key}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("get <key>")
  .description("Print a secret value to stdout")
  .action((key: string) => {
    try {
      const value = vaultGet(key);
      process.stdout.write(value);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("delete <key>")
  .description("Remove a secret")
  .action((key: string) => {
    try {
      vaultDelete(key);
      console.log(`Deleted: ${key}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("list")
  .description("List all stored key names")
  .action(() => {
    try {
      const keys = vaultList();
      if (keys.length === 0) {
        console.log("No secrets stored.");
      } else {
        for (const key of keys) {
          console.log(key);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("init-store")
  .description("Create a new encrypted vault (generates master key in Keychain)")
  .action(() => {
    try {
      initStore();
      console.log("Vault initialized. Master key stored in macOS Keychain.");
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("migrate")
  .description("Migrate secrets from macOS Keychain entries to encrypted store")
  .option("--cleanup", "Delete old Keychain entries after migration")
  .action((opts: { cleanup?: boolean }) => {
    try {
      const result = migrateFromKeychain();

      if (result.migrated.length === 0 && result.errors.length === 0) {
        console.log("No Keychain entries found to migrate.");
        return;
      }

      if (result.migrated.length > 0) {
        console.log(`Migrated ${result.migrated.length} secrets:`);
        for (const key of result.migrated) {
          console.log(`  ${key}`);
        }
      }

      if (result.errors.length > 0) {
        console.log(`Failed to migrate ${result.errors.length} secrets:`);
        for (const key of result.errors) {
          console.log(`  ${key}`);
        }
      }

      if (opts.cleanup && result.migrated.length > 0) {
        const cleanup = cleanupOldKeychainEntries(result.migrated);
        console.log(`\nCleaned up ${cleanup.deleted.length} old Keychain entries.`);
        if (cleanup.errors.length > 0) {
          console.log(`Failed to clean up ${cleanup.errors.length} entries.`);
        }
      } else if (result.migrated.length > 0) {
        console.log("\nRun 'vault migrate --cleanup' to remove old Keychain entries.");
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("init")
  .description("Install Claude Code skill to ~/.claude/skills/vault/")
  .action(() => {
    try {
      installSkill();
      console.log("Installed skill to ~/.claude/skills/vault/SKILL.md");
    } catch (err) {
      handleError(err);
    }
  });

function handleError(err: unknown): never {
  if (err instanceof VaultError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error(`Error: ${(err as Error).message}`);
  }
  process.exit(1);
}

program.parse();
