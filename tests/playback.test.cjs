const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../playback.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness(loadFrame = async index => index, count = 34) {
  let now = 0, id = 0;
  const timers = new Map(), shown = [], errors = [];
  const context = { window: {}, performance: { now: () => now },
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout: key => timers.delete(key) };
  vm.runInNewContext(source, context);
  const player = context.window.createImageSequencePlayer({ count, interval: 1000,
    loadFrame, showFrame: (_, index) => shown.push(index),
    onChange: () => {}, onError: error => errors.push(error) });
  async function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = target;
    await flush();
  }
  return { player, advance, shown, errors };
}

test('cover waits for Play; all 34 frames show once, one second each; Replay restarts', async () => {
  const h = harness();
  await h.advance(5000);
  assert.deepEqual(h.shown, []);
  h.player.play(); await flush();
  assert.deepEqual(h.shown, [0]);
  await h.advance(999); assert.equal(h.player.state().index, 0);
  await h.advance(1); assert.equal(h.player.state().index, 1);
  await h.advance(32000); assert.equal(h.player.state().index, 33);
  assert.equal(h.player.state().playing, true);
  await h.advance(1000);
  assert.equal(h.player.state().ended, true);
  assert.equal(h.player.state().playing, false);
  assert.deepEqual(h.shown, Array.from({ length: 34 }, (_, i) => i));
  h.player.play(); await flush();
  assert.equal(h.player.state().index, 0);
});

test('pause retains the visible frame and remaining fraction of its second', async () => {
  const h = harness(); h.player.play(); await flush();
  await h.advance(350); h.player.pause();
  await h.advance(5000); assert.deepEqual(h.shown, [0]);
  h.player.play(); await h.advance(649); assert.equal(h.player.state().index, 0);
  await h.advance(1); assert.equal(h.player.state().index, 1);
});

test('pausing during image decoding cannot replace the cover or skip the pending frame', async () => {
  let ready;
  const image = new Promise(resolve => { ready = resolve; });
  const h = harness(() => image);
  h.player.play(); h.player.pause(); ready('image'); await flush();
  assert.deepEqual(h.shown, []);
  h.player.play(); await flush();
  assert.deepEqual(h.shown, [0]);
});

test('failed image leaves the current frame in place and Play retries it', async () => {
  let attempt = 0;
  const h = harness(async index => { if (attempt++ === 0) throw Error('missing image'); return index; });
  h.player.play(); await flush();
  assert.equal(h.errors.length, 1);
  assert.equal(h.player.state().playing, false);
  assert.deepEqual(h.shown, []);
  h.player.play(); await flush();
  assert.deepEqual(h.shown, [0]);
});

test('scene times match the 34 playback frames, including copy 13 in slot 02', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scenes.js'), 'utf8'), context);
  const scenes = context.window.KNOTATION_SCENES;
  assert.equal(scenes.length, 34);
  scenes.forEach((scene, index) => {
    const suffix = index === 32 ? '사본 13.png' : `12-${String(34 - index).padStart(2, '0')}.png`;
    assert.ok(scene.image.normalize('NFC').endsWith(suffix));
    assert.ok(fs.existsSync(path.join(__dirname, '../assets', scene.image)));
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../relationships.js'), 'utf8'), context);
  const relationship = context.window.KNOTATION_RELATIONSHIPS[0];
  assert.deepEqual(scenes.map(scene => scene.image), relationship.frames);
  assert.deepEqual(scenes.map(scene => scene.timestamp), relationship.timecodes);
  assert.equal(scenes.filter(scene => scene.caption).length, 26);
});


test('24-frame relationship ends at frame 24 and resets to frame 1 on replay', async () => {
  const h = harness(undefined, 24);
  h.player.play(); await flush();
  await h.advance(24000);
  assert.equal(h.player.state().index, 23);
  assert.equal(h.player.state().ended, true);
  assert.equal(h.shown.length, 24);
  h.player.play(); await flush();
  assert.equal(h.player.state().index, 0);
});
