import test from 'node:test';
import assert from 'node:assert/strict';
import { insertMentionToken, mentionName, uniqueMention } from '../src/referenceMentions.js';

test('reference mentions use compact file names and remain unique', () => {
  assert.equal(mentionName(' 面料 参考图 01.png '), '面料-参考图-01');
  assert.equal(uniqueMention('面料参考.png', ['面料参考']), '面料参考-2');
  assert.equal(uniqueMention('.png'), '参考');
});

test('reference insertion replaces an unfinished mention or appends to the active instruction', () => {
  assert.equal(insertMentionToken('调整 @面', '面料参考'), '调整 @面料参考 ');
  assert.equal(insertMentionToken('调整领口', '面料参考'), '调整领口 @面料参考 ');
  assert.equal(insertMentionToken('', '面料参考'), '@面料参考 ');
});
