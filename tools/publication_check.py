"""Small, offline publication guard. It reports categories and paths, never values.

This complements human review and a dedicated secret scanner; it cannot detect
all proprietary material. Before Git initialization it inspects a source tree;
after initialization it inspects exactly the tracked tree plus untracked source.
"""

from __future__ import annotations

import ipaddress
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
IGNORED_DIRS = {
    ".git", ".venv", "node_modules", ".next", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", "htmlcov", "coverage", "dist", "test-results",
    "playwright-report", "tmp",
}
GENERATED_FILES = {".DS_Store", ".coverage", "next-env.d.ts"}
ALLOWED_SUFFIXES = {
    ".py", ".ts", ".tsx", ".css", ".json", ".mjs", ".cjs", ".yml", ".yaml",
    ".md", ".toml", ".lock", ".ini", ".mako", ".svg", ".png", ".example",
}
ALLOWED_NAMES = {"Dockerfile", ".gitignore", ".dockerignore", ".prettierignore"}
CONTENT_RULES = {
    "private-key material": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "personal filesystem path": re.compile(r"/(?:Users|home)/[^/\s]+|[A-Z]:\\Users\\"),
    "provider token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9]{24,})"),
}
IP_PATTERN = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
EMAIL_PATTERN = re.compile(r"\b[\w.+-]+@([\w.-]+\.[A-Za-z]{2,})\b")


def source_paths(root: Path) -> list[Path]:
    paths: set[Path] = set()
    for directory, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name not in IGNORED_DIRS]
        for name in directories:
            candidate = Path(directory) / name
            if candidate.is_symlink():
                paths.add(candidate)
        for name in files:
            if name in GENERATED_FILES or name.endswith((".db", ".sqlite", ".log", ".tsbuildinfo")):
                continue
            paths.add(Path(directory) / name)
    if (root / ".git").is_dir():
        tracked = subprocess.run(
            ["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True
        ).stdout.decode().split("\0")
        paths.update(root / name for name in tracked if name)
    return sorted(paths)


def inspect(path: Path, root: Path) -> list[str]:
    relative = path.relative_to(root)
    issues: list[str] = []
    if path.is_symlink():
        return ["symlink is not permitted in the public source"]
    if not path.is_file():
        return ["tracked path missing from working tree"]
    if any(part in IGNORED_DIRS for part in relative.parts):
        issues.append("generated or dependency content is tracked")
    if path.name.startswith(".env") and path.name != ".env.example":
        issues.append("non-example environment file")
    if path.name not in ALLOWED_NAMES and path.suffix not in ALLOWED_SUFFIXES:
        issues.append("file type needs publication review")
    if path.stat().st_size > 2_000_000:
        issues.append("large artifact needs publication review")
    if path.suffix == ".png":
        if (
            relative.parent != Path("docs/assets")
            and relative != Path("frontend/public/caterium-logo.png")
        ):
            issues.append("binary image outside documented demo assets")
        return issues
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeError:
        return issues + ["unexpected binary content"]
    for category, pattern in CONTENT_RULES.items():
        if pattern.search(content):
            issues.append(category)
    for match in IP_PATTERN.finditer(content):
        try:
            address = ipaddress.ip_address(match.group())
        except ValueError:
            continue
        if str(address) not in {"127.0.0.1", "0.0.0.0"}:
            issues.append("non-loopback address needs review")
            break
    for match in EMAIL_PATTERN.finditer(content):
        if not match.group(1).endswith((".invalid", ".example")):
            issues.append("email address needs review")
            break
    return sorted(set(issues))


def main() -> int:
    files = source_paths(ROOT)
    problems = 0
    for path in files:
        for category in inspect(path, ROOT):
            print(f"REVIEW {path.relative_to(ROOT)}: {category}")
            problems += 1
    print(f"Publication guard: {len(files)} files inspected; {problems} review items.")
    return int(problems != 0)


if __name__ == "__main__":
    sys.exit(main())
