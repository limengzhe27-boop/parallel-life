import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contradictsSelectedRole } from '../src/modules/world/domain/opening-validation.ts';
test('explicit equal and subordinate roles reject direct superior claims', () => {
  for (const role of ['我的同级摄影搭档，没有上下级关系', '我的下属，负责剪辑'])
    for (const text of ['他是你的直属上司', '我是你老板', '你必须服从我', '所有重大决定都由他批准'])
      assert.equal(contradictsSelectedRole(role, text), true, role + text);
});
test('cooperation, negated superior status and mentions of someone else stay valid', () => {
  for (const text of [
    '我们一起决定，不用由我审批。',
    '不是你的直属上司',
    '不再是你的直属上司',
    '不要说我是你老板',
    '老板在另一个团队工作',
    '他有自己的领导',
    '不代表你必须服从我',
  ])
    assert.equal(contradictsSelectedRole('我的同级搭档', text), false, text);
});
