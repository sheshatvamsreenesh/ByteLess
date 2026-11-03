import assert from 'node:assert/strict';
import test from 'node:test';
import { availableSpeechLanguages, splitSpeechText } from './speech';

test('speech splitter handles empty input and keeps chunks within limit',()=>{
  assert.deepEqual(splitSpeechText('   '),[]);
  const text=('A complete sentence. ').repeat(250);
  const chunks=splitSpeechText(text,180);
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.length<=180));
  assert.equal(chunks.join(' '),text.trim());
});

test('available speech languages are unique and sorted',()=>{
  assert.deepEqual(availableSpeechLanguages([{lang:'fr-FR'},{lang:'en-US'},{lang:'fr-FR'},{lang:''}]),['en-US','fr-FR']);
});
