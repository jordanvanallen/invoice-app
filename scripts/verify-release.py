"""Verify the downloaded draft release before making its updater feed public."""

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlsplit


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_release(tag, directory):
    directory = Path(directory)
    release = json.loads(subprocess.check_output(
        ["gh", "release", "view", tag, "--json", "isDraft,tagName,assets"], text=True
    ))
    require(release["isDraft"], "Release must remain a draft until validation passes")
    require(release["tagName"] == tag, "Release tag mismatch")
    assets = {asset["name"]: asset for asset in release["assets"]}
    for name, asset in assets.items():
        require(Path(name).name == name, f"Invalid asset name: {name}")
        path = directory / name
        require(path.is_file(), f"Missing downloaded asset: {name}")
        require(path.stat().st_size == asset["size"] > 0, f"Invalid asset size: {name}")

    manifest = json.loads((directory / "latest.json").read_text())
    require(manifest["version"] == tag.removeprefix("v"), "Updater version mismatch")
    platforms = manifest["platforms"]
    for platform in ("windows-x86_64", "darwin-aarch64", "darwin-x86_64"):
        require(platform in platforms, f"Missing updater platform: {platform}")
    require(any(name.endswith(".dmg") for name in assets), "Missing macOS installer")
    require(any(name.endswith((".msi", ".exe")) for name in assets), "Missing Windows installer")

    config = json.loads(Path("src-tauri/tauri.conf.json").read_text())
    public_key = directory / "updater-verification.pub"
    public_key.write_bytes(base64.b64decode(config["plugins"]["updater"]["pubkey"], validate=True))
    prefix = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ['GITHUB_REPOSITORY']}/releases/download/{tag}/"
    verified = set()
    for platform, entry in platforms.items():
        url = entry["url"]
        require(url.startswith(prefix), f"Unexpected updater URL for {platform}: {url}")
        parsed = urlsplit(url)
        require(not parsed.query and not parsed.fragment, f"Unexpected updater URL suffix: {url}")
        name = unquote(url[len(prefix):])
        require(name in assets and Path(name).name == name, f"Updater asset missing: {name}")
        if platform.startswith("darwin-"):
            require(name.endswith(".app.tar.gz"), f"Invalid macOS updater artifact: {name}")
        if platform.startswith("windows-"):
            require(name.endswith((".msi", ".exe")), f"Invalid Windows updater artifact: {name}")
        signature_name = f"{name}.sig"
        require(signature_name in assets, f"Updater signature missing: {signature_name}")
        signature = (directory / signature_name).read_text().strip()
        require(entry["signature"].strip() == signature, f"Manifest signature mismatch: {platform}")
        if name not in verified:
            decoded_signature = directory / "updater-verification.sig"
            decoded_signature.write_bytes(base64.b64decode(signature, validate=True))
            subprocess.run([
                "minisign", "-V", "-p", str(public_key),
                "-m", str(directory / name), "-x", str(decoded_signature),
            ], check=True)
            verified.add(name)
    print(f"Verified {tag}: Windows and both Mac updater platforms, {len(verified)} signed updater artifacts")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: verify-release.py version-tag downloaded-artifacts-directory")
    verify_release(sys.argv[1], sys.argv[2])
