import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SKILL_CONTENT = `---
name: vault
description: Access credentials securely via macOS Keychain. Use when you need API keys, tokens, or other secrets at runtime.
---

# Vault — Encrypted Secret Store

Vault stores secrets in an AES-256-GCM encrypted file (~~/mesh-vibe/vault/secrets.enc). The master key is stored in the macOS Keychain — one Keychain entry, one permission prompt.

## CLI commands

- \`vault set <key> <value>\` — store or update a secret
- \`vault get <key>\` — print secret value to stdout (pipe-friendly)
- \`vault delete <key>\` — remove a secret
- \`vault list\` — list all stored key names
- \`vault init-store\` — create a new vault (generates master key)
- \`vault migrate\` — migrate from old per-entry Keychain storage
- \`vault migrate --cleanup\` — migrate and delete old Keychain entries

## Usage in Heartbeat tasks

In task frontmatter \`env:\` blocks, use the \`vault://\` prefix to resolve secrets from Vault:

\`\`\`yaml
env:
  ANTHROPIC_API_KEY: "vault://anthropic-api-key"
\`\`\`

## Inline usage

To use a secret inline in a shell command:

\`\`\`bash
export API_KEY=$(vault get my-api-key)
\`\`\`

## Notes

- Secrets encrypted with AES-256-GCM in ~/mesh-vibe/vault/secrets.enc
- Master key stored as single entry in macOS Keychain (account: vault, service: vault-master-key)
- The \`vault get\` command outputs only the value (no newline) for clean piping
`;

export function installSkill(): void {
  const skillDir = join(homedir(), ".claude", "skills", "vault");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), SKILL_CONTENT, "utf-8");
}
