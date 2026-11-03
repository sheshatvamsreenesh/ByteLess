import assert from 'node:assert/strict';
import test from 'node:test';
import { documentByteDelta } from './performance';

test('scorecard distinguishes true byte savings from a larger output',()=>{
  assert.deepEqual(documentByteDelta(1000,750),{bytesSaved:250,percentageSaved:25,outputLarger:false});
  assert.deepEqual(documentByteDelta(1000,1250),{bytesSaved:-250,percentageSaved:-25,outputLarger:true});
  assert.deepEqual(documentByteDelta(0,10),{bytesSaved:-10,percentageSaved:0,outputLarger:true});
});
