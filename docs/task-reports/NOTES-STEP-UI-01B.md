# NOTES-STEP-UI-01B

2026-10-12；codex-notes-step-ui01b-01a11a84-20261012。
工作树 `.local/worktrees/nar-03`，分支 `codex/notes-step-ui-01b`，基线7597399。

## 范围与问题

根冻结7597399只读public record.stepChecklist契约后，本人仅改 `src/modules/world/domain/player-records.ts`、新 `tests/scene-step-checklist.test.ts` 与本报告。根repo已加载partial stepRefs及actual input/result/action sources；UI/Q、公共contract、原tests、repo、SQL、runtime均只读。旧真实模型本批已paused/closed16/18，不用剩余，不执行新模型/PG。

原便签只有父事项，分步核对即使已真实保存也没有清单；用户难以知道“已核对、还需说明、尚未交出、对方未收件”的区别。此次输出有限官方r17-delivery-v1七步，必需4/可选3、player与actor分开，仅实际保存并验证的步骤勾选。真实说明失败仍不显示完成，不把许可槽/对白/unknown当成实际步骤。

## 可信投影

抽取原 `verifiedStepCompletion` 的source重放为共享 `verifiedStepMatter`，partial清单和fullcompletion里程碑均调用同一实现，避免两套信用判断。每步所有所需 input/result/action 源从immutable initial空进度有界重放，原 `applySceneWorldResults` 继续验证原文、owner/world、scene/receiver、实际人物接收及observerFacts。最终完整重建WorldMatter与当前对象相同才可显示，包括完整stepProgress、evidence、定义、status/assertion、version/updatedAt及其余字段；缺源、冲突重复、缺input元数据/result/action本体全部隐藏清单，不猜快照或退零。

原full wrapper仍只接受scene_steps/r17、completed/world_verified，legacy scene_action验证不变，不放宽整体验收。shared验证保留最终 progressionEvents/result payload一致、邀约response不倒填和来源版本不晚于当前worldVersion等规则。仅新的未知输入增加worldVersion且事项/原有效sources不变时，保留先前有效勾选。

无结构step只能在可信原始固定rule、原定义与完整原状态未变且非terminal时显示全pending；已增加事项版本后ledger被清空不退0/4，直接省略。此为有意保守：没有step来源不能验证后来状态，旧legacy completed无ledger不显示0/4未完成，abandoned/superseded也不误显示待做。初始snapshot有已有ledger拒，不能继承无验证信用。未支持规则/世界、缺initial或定义篡改均无清单。

投影只发固定id/title/required/performer/state，completed才有实际evidence.at；actorName仅实际已保存actor evidence.actorId对应immutable initial公开人物姓名，pending不给姓名或时间，player步骤不给actorName。不输出原input/observation quote、source IDs、owner或NPC persona/private档案。七步中 received/receiver_inspected 是actor，其余player；optional完成不增加completedRequired。

## 验证

- 初33测试在7597399基线25pass/8fail；最终37测试基线29pass/8fail，八个可信初始/partial/complete/optional/unknown/白名单输出正例缺清单均失败，保留真实基线。修后37全过，不修改原有测试。
- 来源真实合成fixture沿原领域三步执行+独立receive，再applySceneWorldResults保存；可选检查/写记录/明确请NPC检查均经原规则保存，不手造已完成快照。
- 0/4全pending、1/4核对、2/4说明、3/4已交出未接收、独立收件4/4及其里程碑/机会、optional3单独显示、unknown新version保旧1/4均通过。
- 缺input/result/action、snapshot-only、mixed owner/world/version、伪quote/NPC接收/失去presence、状态/断言/版本/日期/定义篡改、冲突源、继承ledger、擦除partial ledger、旧legacy completed/非结构规则均拒或省略，原scene_action里程碑兼容。
- 最终9个相关文件149pass、0fail/skip/TODO；包含原来源Q34、原player records/事项/步骤/后续测试及根strict checklist契约2项。类型0、332文件边界通过、本人格式及diff检查通过。
- 0真实模型/图片/PG/生产/端口/浏览器；按根指定未单独跑全量check/build。UI手机/PC由Q，真实PG/完整check/build/生产迁移确认/READY/public由根。

## 接续

待集成验收，准确源码冻结后释放I/Q。rootrepo已接partial refs不由B改；若后续source不足，只省略清单，不能用已完成snapshot补勾。当前只支持固定官方R17，未实现自由世界通用清单、NPC中途移动或真实完整模型体验；arrival方案4850a79已归档不自动实施。

根与Q集成后先验证partial来源在实际PG保存后1/4→2/4→4/4、坏source清单整体隐藏与恢复，原full里程碑未倒退、required/optional人物区别，最终上线证据到齐才标完成。

## 根集成回执及最后只读复核

根将97cfb14准确接为270508014a0ee713f765c407afa40b4960584d10，源审通过；实际本地PG8/8：1/4→新未决input保1/4→2/4+optional不增加必需→actor实收4/4，坏early actual action row隐藏整清单、恢复4且旧milestone保真。仅根合成模型/实际本地事务，B0PG/vendor，本批真实旧预算已closed16/18不复用；完整check正在跑，尚未声明本子批READY/public。

根授权仅报告附注静态审其未发布receiver guard WIP，核查HEAD2705080、guard blob 8b5b5238fd1693df36cfd4538de78bf44f897295、public contract blob b3a569340deca19d68328eb0f9c7a53ff63de72b。原五个OR和short-circuit顺序完全保持：receiver不存在→非related→非present→inputQuote缺name→observationQuote缺name，依次只转not_found/not_related/not_present/input_not_named/observation_not_named五固定码。没有返回值/quote/姓名/ID插值，不改proposal、不补receiver、不改异常code或实际完成判定。静态未见泄漏或条件放宽；未运行新tests/PG，不替代根准确freeze后的动态验收，不证明旧复合错误具体子因或真实说明治愈。

7597399 public契约strict固定7enum、4required/2actor、pending无at/name、completed需at/count一致/未知字段拒，仅读输出shape；来源信用仍由本人shared全source重放与完整matter相同提供，不能从contract单独声称有保存来源。本人源码持续97cfb14冻结，Q UI/双端和根全check/build/迁移/READY/public后才能完成。
