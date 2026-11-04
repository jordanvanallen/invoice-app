import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

describe('release workflow', () => {
  test('syncs app metadata version from the pushed tag before building updater artifacts', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(workflow).toContain('Sync app version from tag');
    expect(workflow).toContain('src-tauri/tauri.conf.json');
    expect(workflow).toContain('package.json');
    expect(workflow).toContain('github.ref_name');
  });

  test('installs every Rust component used by release validation', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(workflow).toMatch(/dtolnay\/rust-toolchain@stable\s+with:\s+components: rustfmt/);
    expect(workflow).toContain('cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check');
  });

  test('applies optional per-tag release notes only after validation and before publishing', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const publish = workflow.slice(workflow.indexOf('\n  publish:'));
    const validate = publish.indexOf('python3 scripts/verify-release.py "$RELEASE_TAG" release-artifacts');
    const notes = publish.indexOf('notes="docs/releases/$RELEASE_TAG.md"');
    const release = publish.indexOf('gh release edit "$RELEASE_TAG" --draft=false --latest');

    expect(validate).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(validate);
    expect(release).toBeGreaterThan(notes);
    expect(publish).toContain('if [ -f "$notes" ]; then');
    expect(publish).toContain('gh release edit "$RELEASE_TAG" --notes-file "$notes"');
  });

  test('per-tag release notes repeat the Mac first-launch instructions they replace', () => {
    const files = readdirSync('docs/releases').filter((file) => /^v\d+\.\d+\.\d+\.md$/.test(file));

    expect(files).toContain('v0.4.0.md');
    for (const file of files) {
      const notes = readFileSync(`docs/releases/${file}`, 'utf8');
      expect(notes, file).toContain('_universal.dmg');
      expect(notes, file).toContain('not Apple-notarized');
      expect(notes, file).toContain('Open Anyway');
    }
  });
});
