import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('Self-hosting Engine updates graph nodes when a tracked source changes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-platform-self-host-'));
  const sourceRoot = path.join(directory, 'source');
  fs.mkdirSync(path.join(sourceRoot, 'backend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'Architecture decision v1\n');
  fs.writeFileSync(path.join(sourceRoot, 'backend', 'src', 'component.js'), 'export const version = 1;\n');
  process.env.SQLITE_PATH = path.join(directory, 'self-host.sqlite');
  process.env.SELF_HOST_WATCH = '0';
  const { getDb, closeDb } = await import('../src/db/database.js');
  const { seedIfEmpty } = await import('../src/db/seed.js');
  const { syncSelfHosting } = await import('../src/services/selfHosting.js');
  const db = getDb();
  try {
    seedIfEmpty();
    const first = syncSelfHosting(db, sourceRoot);
    assert.equal(first.error, null);
    assert.equal(first.files, 2);
    const before = db.prepare("SELECT content_hash FROM self_host_sources WHERE path='README.md'").get().content_hash;
    fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'Architecture decision v2\n');
    const second = syncSelfHosting(db, sourceRoot);
    const after = db.prepare("SELECT content_hash FROM self_host_sources WHERE path='README.md'").get().content_hash;
    assert.notEqual(before, after);
    assert.ok(second.changed >= 1);
    const node = db.prepare("SELECT description FROM nodes WHERE id=(SELECT node_id FROM self_host_sources WHERE path='README.md')").get();
    assert.match(node.description, new RegExp(after));
  } finally {
    closeDb();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
