---
name: vault
description: macOS Keychain secret manager for CLI and agent workflows
cli: vault
data_dir: ~/mesh-vibe/vault
version: 0.1.0
health_check: vault list
depends_on: []
---

Vault wraps the macOS `security` command to store and retrieve secrets from the system Keychain. Hardware-backed encryption via Secure Enclave, no interactive prompts.
