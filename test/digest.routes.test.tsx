import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Temp runs dir: `runs/` is read-only (AGENTS.md), tests never write there.
const NORMAL = '2026-03-01';
const EMPTY = '2026-03-02';
const BAD = '2026-03-03';
const MISSING = '2026-03-04';

const line = (o: Record<string, unknown>) => JSON.stringify(o);

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));

  const normal = [
    line({ at: '2026-03-01T01:00:00+01:00', job: 'zeta/cleanup', status: 'ok', owner: 'ana' }),
    line({ at: '2026-03-01T01:05:00+01:00', job: 'alpha/sync', status: 'ok', owner: null }),
    line({ at: '2026-03-01T01:10:00+01:00', job: 'mid/fetch', status: 'retry', owner: 'bo', error: 'upstream 503' }),
    line({ at: '2026-03-01T01:11:00+01:00', job: 'mid/fetch', status: 'retry', owner: 'bo', error: 'upstream 503' }),
    line({ at: '2026-03-01T01:12:00+01:00', job: 'mid/fetch', status: 'retry', owner: 'bo', error: 'upstream 503' }),
    line({ at: '2026-03-01T01:13:00+01:00', job: 'mid/fetch', status: 'ok', owner: 'bo' }),
    line({ at: '2026-03-01T02:00:00+01:00', job: 'backup/notes', status: 'fail', owner: 'cy', error: 'quota exceeded' }),
  ];
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), normal.join('\n') + '\n');
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  const bad = [
    line({ at: '2026-03-03T01:00:00+01:00', job: 'b/one', status: 'ok', owner: 'ana' }),
    '{"at":"2026-03-03T01:01:00+01:00","job":"b/tw',
    line({ at: '2026-03-03T01:02:00+01:00', job: 'a/two', status: 'ok', owner: 'bo' }),
  ];
  writeFileSync(join(runsDir, `${BAD}.jsonl`), bad.join('\n') + '\n');

  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

const page = async (night: string) => {
  const res = await app.request(`/digest/${night}`);
  return { res, html: await res.text() };
};
const json = async (night: string) => {
  const res = await app.request(`/api/digest/${night}`);
  return { res, body: (await res.json()) as Night & { error?: string } };
};

describe('GET /digest/:night', () => {
  it('renders the normal night: heading, columns, sorted rows, marked rows, dashes, banner', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const { res, html } = await page(NORMAL);
    expect(res.status).toBe(200);
    expect(html).toContain(`<h1>digest ${NORMAL}</h1>`);
    expect(html).toContain('TEST-MARKER');
    for (const col of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first', 'last']) {
      expect(html).toContain(`>${col}</th>`);
    }
    const jobs = ['alpha/sync', 'backup/notes', 'mid/fetch', 'zeta/cleanup'];
    const at = jobs.map((j) => html.indexOf(j));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // marked: 3 retries (mid/fetch) and a fail (backup/notes); the other two are not
    expect(html.match(/<tr class="marked"/g)).toHaveLength(2);
    expect(html).toContain('—'); // null owner and null lastError
    expect(html).toContain('upstream 503');
    expect(html).toContain('quota exceeded');
    expect(html).not.toContain("didn't parse");
  });

  it('renders the empty night: 200, no table, "nothing ran"', async () => {
    const { res, html } = await page(EMPTY);
    expect(res.status).toBe(200);
    expect(html).toContain(`<h1>digest ${EMPTY}</h1>`);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('notes a bad line and still renders the night', async () => {
    const { res, html } = await page(BAD);
    expect(res.status).toBe(200);
    expect(html).toContain("1 line didn't parse");
    expect(html).toContain('a/two');
    expect(html).toContain('b/one');
  });

  it('404s for a night with no file', async () => {
    const { res, html } = await page(MISSING);
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for');
  });

  it('404s for an invalid night', async () => {
    const { res, html } = await page('not-a-date');
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Night object for the normal night', async () => {
    const { res, body } = await json(NORMAL);
    expect(res.status).toBe(200);
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 3, retry: 3, fail: 1 });
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/sync', 'backup/notes', 'mid/fetch', 'zeta/cleanup']);
    const by = Object.fromEntries(body.rows.map((r) => [r.job, r]));
    expect(by['alpha/sync']).toMatchObject({ owner: null, marked: false });
    expect(by['mid/fetch']).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-03-01T01:10:00+01:00',
      lastAt: '2026-03-01T01:13:00+01:00',
      marked: true,
    });
    expect(by['backup/notes']).toMatchObject({ fails: 1, lastStatus: 'fail', lastError: 'quota exceeded', marked: true });
    expect(by['zeta/cleanup']).toMatchObject({ lastError: null, marked: false });
  });

  it('returns empty rows for the empty night', async () => {
    const { res, body } = await json(EMPTY);
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.counts).toEqual({ ok: 0, retry: 0, fail: 0 });
    expect(body.badLines).toBe(0);
  });

  it('counts the bad line and still returns the night', async () => {
    const { res, body } = await json(BAD);
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/two', 'b/one']);
  });

  it('404s with { error, night } for a night with no file', async () => {
    const { res, body } = await json(MISSING);
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'no run log', night: MISSING });
  });

  it('404s with { error, night } for an invalid night', async () => {
    const { res, body } = await json('not-a-date');
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'no run log', night: 'not-a-date' });
  });
});

describe('page and JSON agree (ADR 0001)', () => {
  it.each([NORMAL, BAD])('lists the same jobs in the same order for %s', async (night) => {
    const { html } = await page(night);
    const { body } = await json(night);
    const jobs = body.rows.map((r) => r.job);
    const fromPage = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>/g)].map((m) => m[1]!.trim());
    expect(fromPage).toEqual(jobs);
    expect(html.match(/<tr class="marked"/g)?.length ?? 0).toBe(body.rows.filter((r) => r.marked).length);
  });
});
