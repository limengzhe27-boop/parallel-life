import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPublisherPreparationScope,
  preparationCharacterNames,
} from '../src/modules/settings/domain/publication-preparation-scope.ts';
import {
  PublisherPreparationInputSchema,
  PublisherPreparationMaterialSchema,
  PublisherPreparationOutputSchema,
} from '../src/contracts/publisher-preparation.ts';
const source = (filename: string, content: string) => ({ filename, content });
test('scope suggestion uses every source and gives mixed world content precedence', () => {
  assert.deepEqual(detectPublisherPreparationScope([source('人物.md', '# 人物：阿禾')]), {
    scope: 'characters',
    confidence: 'recognized',
  });
  assert.deepEqual(detectPublisherPreparationScope([source('人物.md', '# 世界设定\n城市')]), {
    scope: 'world',
    confidence: 'recognized',
  });
  assert.deepEqual(
    detectPublisherPreparationScope([
      source('人物.md', '# 人物：阿禾'),
      source('剧情.md', 'later'),
    ]),
    { scope: 'world', confidence: 'recognized' },
  );
  assert.deepEqual(detectPublisherPreparationScope([source('稿.md', '阿禾住在城市。')]), {
    scope: 'world',
    confidence: 'uncertain',
  });
  assert.equal(detectPublisherPreparationScope([]).confidence, 'uncertain');
  assert.equal(
    detectPublisherPreparationScope(Array(33).fill(source('人物.md', 'x'))).confidence,
    'uncertain',
  );
});
test('explicit names exclude incidental friends in prose, generic headings and ambiguous labels', () => {
  assert.deepEqual(
    preparationCharacterNames([source('人物.md', '# 人物：阿禾\n她提到阿林。\n## 背景\n旧事')]),
    ['阿禾'],
  );
  assert.deepEqual(
    preparationCharacterNames([source('角色.md', '| 姓名 | 宁遥 |\n## 动机\n认识许文')]),
    ['宁遥'],
  );
  assert.deepEqual(preparationCharacterNames([source('人物/阿禾.md', '# 人物设定\n她是店主。')]), [
    '阿禾',
  ]);
  assert.deepEqual(preparationCharacterNames([source('人物.md', '# 人物设定\n只有一位朋友')]), []);
  assert.deepEqual(preparationCharacterNames([source('人物.md', '# 阿禾\n内容\n# 宁遥\n内容')]), [
    '阿禾',
    '宁遥',
  ]);
});
test('scope is optional without adding a default to old request, material or result', () => {
  const material = { currentContent: {}, sources: [source('人物.md', '# 人物：阿禾')] };
  const input = {
    commandId: '00000000-0000-4000-8000-000000000001',
    expectedDraftVersion: 0,
    ...material,
  };
  assert.equal(Object.hasOwn(PublisherPreparationInputSchema.parse(input), 'scope'), false);
  assert.equal(Object.hasOwn(PublisherPreparationMaterialSchema.parse(material), 'scope'), false);
  assert.equal(
    Object.hasOwn(
      PublisherPreparationOutputSchema.parse({
        updatedContent: {},
        summary: '旧结果',
        notes: [],
        issues: [],
      }),
      'scope',
    ),
    false,
  );
  assert.equal(
    PublisherPreparationInputSchema.parse({ ...input, scope: 'characters' }).scope,
    'characters',
  );
  assert.equal(
    PublisherPreparationInputSchema.safeParse({ ...input, scope: 'anything' }).success,
    false,
  );
});

test('generic character document titles cannot become fabricated person names', () => {
  for (const title of ['人物简介', '角色小传', '人物原稿', '朋友资料'])
    assert.deepEqual(
      preparationCharacterNames([source(`${title}.md`, `# ${title}\n一位未命名朋友。`)]),
      [],
    );
  assert.deepEqual(preparationCharacterNames([source('人物：阿禾.md', '# 人物设定\n正文')]), [
    '阿禾',
  ]);
});

test('scope ignores ZIP wrapper and directories but keeps individual world documents and headings', () => {
  for (const filename of [
    '世界剧本.zip > 人物_青青.md',
    '世界剧本.zip > 世界/人物1_青青.md',
    '世界剧本.zip &gt; 世界\\人物1_青青.md',
    '世界/人物1_青青.md',
  ]) {
    assert.deepEqual(detectPublisherPreparationScope([source(filename, '她经营一家花店。')]), {
      scope: 'characters',
      confidence: 'recognized',
    });
    assert.deepEqual(preparationCharacterNames([source(filename, '她提到小明。')]), ['青青']);
  }
  assert.deepEqual(detectPublisherPreparationScope([source('人物.zip > 世界.md', '文字')]), {
    scope: 'world',
    confidence: 'recognized',
  });
  assert.deepEqual(
    detectPublisherPreparationScope([source('世界.zip > 人物.md', '# 世界设定\n文字')]),
    { scope: 'world', confidence: 'recognized' },
  );
  assert.deepEqual(
    detectPublisherPreparationScope([source('人物.zip > 目录/随笔.md', '提到青青。')]),
    { scope: 'world', confidence: 'uncertain' },
  );
  assert.deepEqual(
    preparationCharacterNames([source('人物.zip > 随笔.md', '# 春天\n她提到青青。')]),
    [],
  );
  assert.deepEqual(preparationCharacterNames([source('人物/随笔.md', '她提到青青。')]), []);
});
test('numbered individual filenames and explicit character headings identify only the declared subject', () => {
  for (const filename of ['人物1_青青.md', '人物12-青青.md', '角色 2_青青.txt'])
    assert.deepEqual(preparationCharacterNames([source(filename, '她提到小明。')]), ['青青']);
  for (const heading of ['# 人物1：青青', '# 角色：青青', '## 人物 2：青青'])
    assert.deepEqual(
      preparationCharacterNames([source('世界剧本.zip > 资料.md', `${heading}\n她提到小明。`)]),
      ['青青'],
    );
  assert.deepEqual(
    preparationCharacterNames([source('世界剧本.zip > 人物1.md', '一位未命名朋友。')]),
    [],
  );
});
