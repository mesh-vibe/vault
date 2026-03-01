# Vault

A lightweight macOS Keychain secret manager for CLI and agent workflows.

Vault wraps the macOS `security` command to store and retrieve secrets from the system Keychain. Secrets are encrypted at rest using hardware-backed encryption via the Secure Enclave — no config files, no master passwords, no interactive prompts.

Built for unattended automation where tools like 1Password require biometric auth that blocks headless execution.

## Install

```bash
git clone https://github.com/cday-with-ai/Vault.git
cd vault
npm install
npm run build
npm link
```

## CLI

```
vault set <key> <value>    Store or update a secret
vault get <key>            Print secret value to stdout (pipe-friendly)
vault delete <key>         Remove a secret
vault list                 List all stored key names
vault init                 Install Claude Code skill to ~/.claude/skills/vault/
```

### Examples

```bash
# Store a secret
vault set anthropic-api-key sk-ant-...

# Retrieve it
vault get anthropic-api-key

# Use inline
export API_KEY=$(vault get anthropic-api-key)

# List all keys
vault list

# Remove a secret
vault delete old-key
```

## How it works

All secrets are stored in the default macOS login Keychain as generic passwords with account `vault`. Operations use `/usr/bin/security` directly via `execFileSync` with array arguments (no shell interpolation).

| Operation | Keychain command |
|-----------|-----------------|
| `set`     | `security add-generic-password -a vault -s <key> -w <value> -U` |
| `get`     | `security find-generic-password -a vault -s <key> -w` |
| `delete`  | `security delete-generic-password -a vault -s <key>` |
| `list`    | `security dump-keychain` (filtered for account=vault) |

## Library usage

Vault also exports its functions for use as a Node.js module:

```typescript
import { vaultGet, vaultSet, vaultDelete, vaultList } from "vault-keychain";

const key = vaultGet("anthropic-api-key");
```

## Integration with Heartbeat

[Heartbeat](https://github.com/cday-with-ai/Heartbeat) task files support a `vault://` prefix in `env:` blocks:

```yaml
env:
  ANTHROPIC_API_KEY: "vault://anthropic-api-key"
```

This resolves the secret from Vault at runtime without any interactive auth.

## Requirements

- macOS (uses the system Keychain)
- Node.js >= 20

## License

MIT
