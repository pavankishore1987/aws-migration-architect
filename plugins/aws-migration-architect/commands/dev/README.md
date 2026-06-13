# Dev-only skill commands

Slash commands in this folder are for **plugin development and testing** — not end-user documentation.

## Invocation

```
/aws-migration-architect:dev:<skill-name>
```

Examples:

```
/aws-migration-architect:dev:inventory
/aws-migration-architect:dev:cost-summary
/aws-migration-architect:dev:dependency-analyzer --run-dir ~/.aws-migration/runs/...
```

## Gate

Every dev command **refuses to run** unless:

```bash
export AWS_MIGRATION_DEV=true
```

Without that env var, Claude tells the caller to use chat (`Use the <skill> skill`) or the user-facing flows (`:discover`, `:migrate`, etc.).

## Visibility

Claude Code has no “hidden command” flag. These commands still appear in `/help` under the `dev` namespace for anyone who installs this plugin. End users are not directed to them in README or spec user guides. For hard isolation, maintain a separate local-only marketplace that includes only the dev plugin (optional).

## User-facing commands (unchanged)

```
/aws-migration-architect:discover
/aws-migration-architect:migrate
/aws-migration-architect:execute
/aws-migration-architect:audit
```
