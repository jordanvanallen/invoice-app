import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

describe('release workflow', () => {
  test('syncs app metadata version from the pushed tag before building updater artifacts', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(workflow).toContain('Sync app version from tag');
    expect(workflow).toContain('src-tauri/tauri.conf.json');
    expect(workflow).toContain('package.json');
    expect(workflow).toContain('github.ref_name');
  });
});
