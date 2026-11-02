"""tktop-tui: Python launcher for the tktop TUI.

`pip install tktop-tui` gives you the `tktop` command. The wheel bundles the
TypeScript TUI (src/ + bin/); on first run it is staged into a user cache dir
(~/.local/share/tktop/<version>) where `bun install` fetches its JavaScript
dependencies, then the TUI is exec'd under Bun. Read-only site-packages are
never touched.
"""

import json
import os
import shutil
import subprocess
import sys
from importlib.resources import as_file, files
from pathlib import Path

VERSION = "0.3.4"
HOMEPAGE = "https://github.com/AlexKay28/tktop"


def find_bun() -> str | None:
    """Locate bun on PATH or in its default install location."""
    found = shutil.which("bun")
    if found:
        return found
    default = Path.home() / ".bun" / "bin" / "bun"
    return str(default) if default.is_file() and os.access(default, os.X_OK) else None


def stage_tui() -> Path:
    """Copy the bundled TUI into a per-version cache dir (once per version)."""
    base = Path.home() / ".local" / "share" / "tktop" / VERSION
    marker = base / ".installed"
    if marker.is_file():
        return base
    if base.exists():
        shutil.rmtree(base)
    base.parent.mkdir(parents=True, exist_ok=True)
    src = files("tktop_tui").joinpath("tui")
    with as_file(src) as src_path:
        shutil.copytree(src_path, base)
    marker.write_text("staged\n")
    return base


def main() -> None:
    bun = find_bun()
    if not bun:
        print("tktop: bun is required but not installed.", file=sys.stderr)
        print("  install it with: curl -fsSL https://bun.sh/install | bash", file=sys.stderr)
        print(f"  project: {HOMEPAGE}", file=sys.stderr)
        raise SystemExit(1)

    tui = stage_tui()

    # fetch JS dependencies once per staged version (needs network on first run)
    if not (tui / "node_modules").is_dir():
        pkg = json.loads((tui / "package.json").read_text())
        pkg.pop("devDependencies", None)  # @types/bun is not needed at runtime
        pkg.get("scripts", {}).pop("prepublishOnly", None)
        (tui / "package.json").write_text(json.dumps(pkg))
        r = subprocess.run([bun, "install", "--production"], cwd=tui)
        if r.returncode != 0:
            print("tktop: bun install failed (network reachable?).", file=sys.stderr)
            raise SystemExit(1)

    os.execv(bun, [bun, "run", str(tui / "src" / "index.ts"), *sys.argv[1:]])


if __name__ == "__main__":
    main()
