#!/usr/bin/env python3
"""Validate the aws-migration-architect plugin against Claude Code's manifest rules.

Run BEFORE adding/installing the marketplace to catch manifest errors locally
(e.g. the "homepage: Invalid URL" install failure caused by an empty-string URL).

Checks, mirroring Claude Code / marketplace validation:
  plugin.json
    - required: name, version, description, author(.name)
    - name is kebab-case
    - version is semver x.y.z
    - homepage / repository, author.url: valid http(s) URL *if present* (empty string is INVALID)
    - author.email: valid email if present
    - only known top-level fields (warns on extras; strict marketplaces reject them)
  marketplace.json
    - required: name, owner(.name), plugins[]
    - each plugin: name + source; source directory exists and contains .claude-plugin/plugin.json
    - marketplace plugin version matches plugin.json version
  every skills/<x>/SKILL.md and agents/<x>.md
    - has YAML frontmatter with name + description
  .mcp.json is valid JSON

Exit code 0 = all green, 1 = errors. No third-party dependencies.

Usage: python3 scripts/validate-plugin.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN_DIR = ROOT / "plugins" / "aws-migration-architect"
PLUGIN_JSON = PLUGIN_DIR / ".claude-plugin" / "plugin.json"
MARKETPLACE_JSON = ROOT / ".claude-plugin" / "marketplace.json"

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
URL = re.compile(r"^https?://[^\s]+$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PERMITTED_PLUGIN_FIELDS = {
    "name", "displayName", "version", "description", "author",
    "homepage", "repository", "license", "keywords", "$schema",
    "skills", "commands", "agents", "hooks", "mcpServers",
    "outputStyles", "lspServers", "experimental", "dependencies", "defaultEnabled",
}

errors: list[str] = []
warnings: list[str] = []


def err(m): errors.append(m)
def warn(m): warnings.append(m)


def load_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        err(f"missing file: {p}")
    except json.JSONDecodeError as e:
        err(f"invalid JSON in {p.name}: {e}")
    return None


def is_url(v) -> bool:
    return isinstance(v, str) and bool(URL.match(v))


def validate_plugin_json():
    m = load_json(PLUGIN_JSON)
    if m is None:
        return None
    for f in ("name", "version", "description", "author"):
        if f not in m:
            err(f"plugin.json: missing required field '{f}'")
    if "name" in m and not KEBAB.match(str(m["name"])):
        err(f"plugin.json: name '{m['name']}' is not kebab-case")
    if "version" in m and not SEMVER.match(str(m["version"])):
        err(f"plugin.json: version '{m['version']}' is not semver x.y.z")
    # URL fields: the empty-string trap that broke the install
    for f in ("homepage", "repository"):
        if f in m:
            if m[f] == "":
                err(f"plugin.json: '{f}' is an empty string — omit the key or use a valid URL")
            elif not is_url(m[f]):
                err(f"plugin.json: '{f}' is not a valid http(s) URL: {m[f]!r}")
    author = m.get("author")
    if isinstance(author, dict):
        if not author.get("name"):
            err("plugin.json: author.name is required")
        if "url" in author and author["url"] != "" and not is_url(author["url"]):
            err(f"plugin.json: author.url is not a valid URL: {author['url']!r}")
        if "url" in author and author["url"] == "":
            err("plugin.json: author.url is an empty string — omit it or use a valid URL")
        if author.get("email") and not EMAIL.match(author["email"]):
            err(f"plugin.json: author.email is not a valid email: {author['email']!r}")
    elif author is not None and not isinstance(author, str):
        err("plugin.json: author must be an object or string")
    for f in m:
        if f not in PERMITTED_PLUGIN_FIELDS:
            warn(f"plugin.json: unknown field '{f}' (strict marketplaces reject extras)")
    return m


def validate_marketplace_json(plugin_manifest):
    m = load_json(MARKETPLACE_JSON)
    if m is None:
        return
    if not m.get("name"):
        err("marketplace.json: missing 'name'")
    owner = m.get("owner")
    if not (isinstance(owner, dict) and owner.get("name")):
        err("marketplace.json: missing owner.name")
    plugins = m.get("plugins")
    if not isinstance(plugins, list) or not plugins:
        err("marketplace.json: 'plugins' must be a non-empty array")
        return
    for p in plugins:
        nm = p.get("name", "<unnamed>")
        if not p.get("name"):
            err("marketplace.json: a plugin entry is missing 'name'")
        src = p.get("source")
        if not src:
            err(f"marketplace.json: plugin '{nm}' is missing 'source'")
            continue
        src_dir = (ROOT / src).resolve()
        if not src_dir.is_dir():
            err(f"marketplace.json: plugin '{nm}' source dir does not exist: {src}")
        elif not (src_dir / ".claude-plugin" / "plugin.json").is_file():
            err(f"marketplace.json: plugin '{nm}' source has no .claude-plugin/plugin.json")
        if plugin_manifest and "version" in p and p["version"] != plugin_manifest.get("version"):
            warn(f"marketplace.json: plugin '{nm}' version {p['version']} != plugin.json {plugin_manifest.get('version')}")


def validate_frontmatter():
    md_files = list((PLUGIN_DIR / "skills").glob("*/SKILL.md")) + list((PLUGIN_DIR / "agents").glob("*.md"))
    for f in md_files:
        text = f.read_text(encoding="utf-8")
        if not text.startswith("---"):
            err(f"{f.relative_to(ROOT)}: missing YAML frontmatter")
            continue
        block = text.split("---", 2)
        if len(block) < 3:
            err(f"{f.relative_to(ROOT)}: malformed frontmatter")
            continue
        fm = block[1]
        if "name:" not in fm:
            err(f"{f.relative_to(ROOT)}: frontmatter missing 'name:'")
        if "description:" not in fm:
            err(f"{f.relative_to(ROOT)}: frontmatter missing 'description:'")


def validate_mcp():
    mcp = PLUGIN_DIR / ".mcp.json"
    if mcp.is_file():
        load_json(mcp)


def main() -> int:
    manifest = validate_plugin_json()
    validate_marketplace_json(manifest)
    validate_frontmatter()
    validate_mcp()

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print()
    if errors:
        print(f"{len(errors)} ERROR(S), {len(warnings)} warning(s) — plugin will FAIL validation")
        return 1
    print(f"ALL GREEN ({len(warnings)} warning(s)) — manifests pass Claude Code validation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
