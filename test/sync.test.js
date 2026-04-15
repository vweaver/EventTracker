// test/sync.test.js — stubs fetch to exercise the Telegram network
// calls and exhaustively covers mergeSnapshots(). See TECH_SPEC.md
// "Testing → sync.test.js".

import test from 'node:test';
import assert from 'node:assert/strict';

import { pushSnapshot, pullLatest, mergeSnapshots } from '../sync.js';

function installFetchStub(handler) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length - 1);
  };
  return {
    calls,
    restore() { globalThis.fetch = prev; },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// --- pushSnapshot ----------------------------------------------------------

test('pushSnapshot: builds multipart request with events JSON + caption', async () => {
  const stub = installFetchStub(async () =>
    jsonResponse({ ok: true, result: { message_id: 99 } }),
  );
  try {
    const events = [
      { id: 1, timestamp: '2026-04-14T10:15:00', value: 1 },
      { id: 2, timestamp: '2026-04-14T10:16:00', value: 0 },
    ];
    const res = await pushSnapshot({
      token: 'AAA:secret',
      chatId: 123,
      events,
      deviceTag: 'phone',
    });
    assert.equal(res.ok, true);
    assert.equal(res.messageId, 99);
    assert.equal(stub.calls.length, 1);

    const { url, init } = stub.calls[0];
    assert.ok(url.startsWith('https://api.telegram.org/bot'));
    assert.ok(url.includes('AAA'));
    assert.ok(url.endsWith('/sendDocument'));
    assert.equal(init.method, 'POST');
    assert.ok(init.body instanceof FormData);

    assert.equal(init.body.get('chat_id'), '123');
    const caption = init.body.get('caption');
    assert.ok(
      typeof caption === 'string' && caption.startsWith('eventtracker-'),
      `caption should start with eventtracker-, got: ${caption}`,
    );
    assert.ok(
      caption.endsWith('-phone'),
      `caption should end with device tag, got: ${caption}`,
    );

    const doc = init.body.get('document');
    assert.ok(doc instanceof Blob);
    assert.equal(doc.type, 'application/json');
    const text = await doc.text();
    const payload = JSON.parse(text);
    assert.deepEqual(payload.events, events);

    // Guardrail: token must not leak into caption or body fields.
    assert.ok(!caption.includes('AAA:secret'));
    assert.ok(!text.includes('AAA:secret'));
  } finally {
    stub.restore();
  }
});

test('pushSnapshot: rejects when token is missing', async () => {
  await assert.rejects(
    pushSnapshot({ token: '', chatId: 1, events: [], deviceTag: 'd' }),
    /token is required/,
  );
});

test('pushSnapshot: rejects when chatId is missing', async () => {
  await assert.rejects(
    pushSnapshot({ token: 't', chatId: '', events: [], deviceTag: 'd' }),
    /chatId is required/,
  );
});

// --- pullLatest ------------------------------------------------------------

test('pullLatest: finds and parses the most-recent matching snapshot', async () => {
  const fakeEvents = [
    { id: 7, timestamp: '2026-04-01T10:00:00', value: 1 },
  ];
  const stub = installFetchStub(async (url) => {
    if (url.includes('/getUpdates')) {
      return jsonResponse({
        ok: true,
        result: [
          // Older, non-matching chat
          {
            update_id: 1,
            message: {
              message_id: 1,
              date: 1700000000,
              chat: { id: 999 },
              caption: 'eventtracker-2026-01-01T00:00:00Z-a',
              document: {
                file_id: 'WRONG-CHAT',
                mime_type: 'application/json',
              },
            },
          },
          // Older matching snapshot
          {
            update_id: 2,
            message: {
              message_id: 10,
              date: 1700000100,
              chat: { id: 42 },
              caption: 'eventtracker-2026-02-01T00:00:00Z-a',
              document: { file_id: 'OLD', mime_type: 'application/json' },
            },
          },
          // Newest matching snapshot
          {
            update_id: 3,
            message: {
              message_id: 20,
              date: 1700000200,
              chat: { id: 42 },
              caption: 'eventtracker-2026-03-01T00:00:00Z-a',
              document: { file_id: 'NEW', mime_type: 'application/json' },
            },
          },
          // A non-snapshot message (no document)
          {
            update_id: 4,
            message: {
              message_id: 21,
              date: 1700000300,
              chat: { id: 42 },
              text: 'just a message',
            },
          },
        ],
      });
    }
    if (url.includes('/getFile')) {
      assert.ok(url.includes('NEW'), 'should request the newest file_id');
      return jsonResponse({
        ok: true,
        result: { file_path: 'documents/file_5.json' },
      });
    }
    if (url.includes('/file/bot')) {
      return jsonResponse({ events: fakeEvents });
    }
    throw new Error('unexpected url ' + url);
  });
  try {
    const out = await pullLatest({ token: 'tok', chatId: 42 });
    assert.ok(out, 'expected a result');
    assert.equal(out.messageId, 20);
    assert.deepEqual(out.events, fakeEvents);
  } finally {
    stub.restore();
  }
});

test('pullLatest: returns null when no matching snapshot exists', async () => {
  const stub = installFetchStub(async () =>
    jsonResponse({ ok: true, result: [] }),
  );
  try {
    const out = await pullLatest({ token: 't', chatId: 1 });
    assert.equal(out, null);
  } finally {
    stub.restore();
  }
});

// --- mergeSnapshots --------------------------------------------------------

test('mergeSnapshots: remote-only id is inserted', () => {
  const local = [{ id: 1, timestamp: '2026-04-01T10:00:00', value: 1 }];
  const remote = [{ id: 2, timestamp: '2026-04-02T10:00:00', value: 0 }];
  const { events, added, updated, removed } = mergeSnapshots(local, remote);
  assert.equal(added, 1);
  assert.equal(updated, 0);
  assert.equal(removed, 0);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.id),
    [2, 1], // newer timestamp first
  );
});

test('mergeSnapshots: identical payload on same id is not counted as updated', () => {
  const ev = { id: 1, timestamp: '2026-04-01T10:00:00', value: 1 };
  const { added, updated } = mergeSnapshots([ev], [{ ...ev }]);
  assert.equal(added, 0);
  assert.equal(updated, 0);
});

test('mergeSnapshots: conflict — remote newer wins', () => {
  const local = [{ id: 1, timestamp: '2026-04-01T10:00:00', value: 1 }];
  const remote = [{ id: 1, timestamp: '2026-04-05T10:00:00', value: 0 }];
  const { events, updated } = mergeSnapshots(local, remote);
  assert.equal(updated, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, '2026-04-05T10:00:00');
  assert.equal(events[0].value, 0);
});

test('mergeSnapshots: conflict — local newer wins', () => {
  const local = [{ id: 1, timestamp: '2026-04-05T10:00:00', value: 1 }];
  const remote = [{ id: 1, timestamp: '2026-04-01T10:00:00', value: 0 }];
  const { events, updated } = mergeSnapshots(local, remote);
  assert.equal(updated, 0);
  assert.equal(events[0].timestamp, '2026-04-05T10:00:00');
  assert.equal(events[0].value, 1);
});

test('mergeSnapshots: conflict — tie prefers remote', () => {
  const local = [{ id: 1, timestamp: '2026-04-01T10:00:00', value: 1 }];
  const remote = [{ id: 1, timestamp: '2026-04-01T10:00:00', value: 0 }];
  const { events, updated } = mergeSnapshots(local, remote);
  assert.equal(updated, 1);
  assert.equal(events[0].value, 0);
});

test('mergeSnapshots: local-only ids are preserved', () => {
  const local = [
    { id: 1, timestamp: '2026-04-01T10:00:00', value: 1 },
    { id: 2, timestamp: '2026-04-02T10:00:00', value: 0 },
  ];
  const remote = [{ id: 1, timestamp: '2026-04-01T10:00:00', value: 1 }];
  const { events, removed } = mergeSnapshots(local, remote);
  assert.equal(removed, 0);
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.id === 2));
});

test('mergeSnapshots: combined scenario', () => {
  const local = [
    { id: 1, timestamp: '2026-04-01T10:00:00', value: 1 },
    { id: 3, timestamp: '2026-04-03T10:00:00', value: 0 },
  ];
  const remote = [
    { id: 1, timestamp: '2026-04-05T10:00:00', value: 0 }, // update (newer)
    { id: 2, timestamp: '2026-04-02T10:00:00', value: 1 }, // new
  ];
  const { events, added, updated, removed } = mergeSnapshots(local, remote);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.equal(removed, 0);
  assert.equal(events.length, 3);
  // Sorted timestamp desc, id desc.
  assert.deepEqual(
    events.map((e) => e.id),
    [1, 3, 2],
  );
});
