const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'relationships.js'), 'utf8'), context);
const relationships = context.window.KNOTATION_RELATIONSHIPS;
test('twelve selectable scores, including three awaiting their bracelets', () => {
  assert.equal(relationships.length, 12);
  assert.equal(relationships.filter(r => r.bracelet).length, 9);
  assert.ok(relationships.every(relation => !relation.name.includes("-")));
  for (const relation of relationships) {
    if (relation.bracelet) assert.ok(fs.existsSync(path.join(root, 'assets', relation.bracelet)));
    for (const file of [relation.cover, ...relation.frames].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(root, 'assets', file)), file);
    }
  }
  assert.equal(relationships[0].cover, relationships[0].frames.at(-1));
  assert.equal(relationships[0].frames.length, 34);
  relationships[0].frames.forEach((file, i) => {
    const suffix = i === 32 ? '사본 13.png' : `12-${String(34 - i).padStart(2, '0')}.png`;
    assert.ok(file.normalize('NFC').endsWith(suffix), file);
  });
  const supplied = fs.readdirSync(path.join(root, 'assets'))
    .filter(file => file.normalize('NFC').startsWith('다시1_') && file.endsWith('.png'));
  assert.deepEqual([...new Set(relationships[0].frames)].sort(), supplied.sort());
  for (const [index, prefix] of [[1, '다시2_'], [2, '다시3_'], [3, '다시4_'], [4, '다시5_'], [5, '다시7_'], [6, '다시6_'], [7, '다시8_'], [8, '다시9_'], [9, '기보마지막1_'], [10, '마지막2_'], [11, '마지막3_']]) {
    const exported = fs.readdirSync(path.join(root, 'assets'))
      .filter(file => file.normalize('NFC').startsWith(prefix) && file.endsWith('.png'));
    assert.deepEqual([...new Set(relationships[index].frames)].sort(), exported.sort());
    assert.equal(relationships[index].cover, relationships[index].frames.at(-1));
  }
  assert.equal(relationships[1].frames.length, 24);
  assert.ok(relationships[1].cover.endsWith('1-01.png'));
  relationships[1].frames.forEach((file, i) => assert.ok(file.endsWith(`1-${String(24 - i).padStart(2, '0')}.png`)));
  for (const [index, count] of [[2, 8], [3, 25], [4, 10], [6, 19], [8, 28], [9, 19], [10, 23], [11, 9]]) {
    const relation = relationships[index];
    assert.equal(relation.frames.length, count);
    assert.ok(relation.cover.endsWith('-01.png'));
    relation.frames.forEach((file, i) => assert.ok(file.endsWith(`-${String(count - i).padStart(2, '0')}.png`)));
  }

});

test('provided film timecodes match every frame and increase chronologically', () => {
  const endings = ['02:14:13', '02:18:30', '02:08:53', '02:59:04', '02:45:38', '02:15:00', '02:04:44', '02:05:30', '01:30:00', '01:26:33', '01:46:05', '01:32:20'];
  assert.equal(relationships[9].name, 'Elena × Raoul Dorfman');
  assert.equal(relationships[9].bracelet, null);
  assert.equal(relationships[10].name, 'Yuta × Kou');
  assert.equal(relationships[10].bracelet, null);
  assert.equal(relationships[11].name, 'Kou × Fumi');
  assert.equal(relationships[11].bracelet, null);
  assert.equal(relationships.length, endings.length);
  relationships.forEach((relation, i) => {
    assert.equal(relation.timecodes.length, relation.frames.length);
    assert.equal(relation.timecodes[0], i === 7 ? '00:27:30' : '00:00:00');
    assert.equal(relation.timecodes.at(-1), endings[i]);
    let previous = -1;
    for (const code of relation.timecodes) {
      assert.match(code, /^\d{2}:[0-5]\d:[0-5]\d$/);
      const seconds = code.split(':').reduce((total, part) => total * 60 + Number(part), 0);
      assert.ok(seconds > previous); previous = seconds;
    }
  });
});

test('Hana and Tetsuko use 28 artwork frames, excluding the blank export', () => {
  const relation = relationships[5];
  assert.equal(relation.name, 'Hana Arai × Tetsuko Alice Arisugawa');
  assert.equal(relation.frames.length, 28);
  assert.equal(relation.cover, relation.frames.at(-1));
  relation.frames.forEach((file, i) => assert.ok(file.endsWith(`12-${String(29 - i).padStart(2, '0')}.png`)));
});

test('bracelet8 retains the former 05.5 scene as copy between new 07 and 05', () => {
  const relation = relationships[7];
  const order = ['10', '09', '08', '07', 'copy', '05', '04', '03', '02', '01'];
  assert.equal(relation.frames.length, order.length);
  order.forEach((suffix, i) => assert.ok(suffix === 'copy' ? relation.frames[i].normalize('NFC').endsWith('대지 1 사본.png') : relation.frames[i].endsWith(`-${suffix}.png`)));
  assert.equal(relation.timecodes[4], '01:26:15');
  assert.equal(relation.timecodes[5], '01:33:15');
  assert.equal(relation.timecodes[7], '01:45:15');
  assert.equal(relation.timecodes[9], '02:05:30');
});
