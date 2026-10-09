import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBasicInfoFromText } from '../src/modules/profile/infrastructure/interview-planner.ts';

test('fictional first-person identity never becomes real basic information', () => {
  assert.deepEqual(
    extractBasicInfoFromText('故事里第一张是小芳，我的职业是摄影师，我是2001年的'),
    {},
  );
  assert.deepEqual(
    extractBasicInfoFromText('我的职业是摄影师，我是2001年的', ['我要创建古惑仔的故事']),
    {},
  );
  assert.deepEqual(extractBasicInfoFromText('我叫阿明', ['故事里我是摄影师', '继续这个设定']), {});
});

test('explicit return to reality resumes literal self-attribution', () => {
  assert.deepEqual(
    extractBasicInfoFromText('现实中我的职业是工程师，我是2001年的', ['故事里我是摄影师']),
    { occupation: '工程师', birthdate: '2001' },
  );
  assert.deepEqual(extractBasicInfoFromText('我的职业是工程师', ['故事里我是摄影师', '回到现实']), {
    occupation: '工程师',
  });
  assert.deepEqual(extractBasicInfoFromText('故事里我叫阿明，现实中我叫小林'), { name: '小林' });
  assert.deepEqual(extractBasicInfoFromText('我的职业是工程师'), { occupation: '工程师' });
});

test('a wish to become someone is not a current occupation', () => {
  assert.equal(extractBasicInfoFromText('我想成为摄影师').occupation, undefined);
  assert.equal(extractBasicInfoFromText('我的职业是工程师').occupation, '工程师');
  assert.deepEqual(extractBasicInfoFromText('我的职业是摄影师', ['故事里继续', '现实太累了']), {});
});
