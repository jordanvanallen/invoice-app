#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 app-path expected-version [architectures...]" >&2
  exit 2
fi

app=$1
expected_version=$2
shift 2
architectures=("$@")
if [[ ${#architectures[@]} -eq 0 ]]; then
  architectures=(arm64 x86_64)
fi

# A linker-signed executable alone does not seal the app bundle. This was the
# cause of the damaged-app error in 0.3.2, so require its resource seal as well.
if [[ ! -s "$app/Contents/_CodeSignature/CodeResources" ]]; then
  echo "Missing app bundle resource seal: $app" >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=4 "$app"

plist="$app/Contents/Info.plist"
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")
if [[ "$version" != "$expected_version" ]]; then
  echo "Expected app version $expected_version, found $version: $app" >&2
  exit 1
fi
executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")
test -x "$app/Contents/MacOS/$executable"
lipo "$app/Contents/MacOS/$executable" -verify_arch "${architectures[@]}"

echo "Verified app signature, resource seal, version $version, and architectures ${architectures[*]}: $app"
# Ad-hoc signing proves bundle integrity. Gatekeeper still requires the user's
# first-launch approval because this app has no Developer ID/notarization ticket.
