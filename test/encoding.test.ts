import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source files are UTF-8. A file saved in another code page renders `·` and `—` as `�` or `Â·`.
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('source encoding', () => {
  it.each(files('src'))('%s is clean UTF-8', (file) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file));
    expect(text).not.toMatch(/�|Â[·—]/);
  });
});
