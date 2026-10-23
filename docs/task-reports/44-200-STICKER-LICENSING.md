# 44-200 表情包素材供应链与授权记录

状态：**用户已确认可直接使用；60 张已进入静态目录，80 个 catalog ID 可发送。**
本报告记录来源、许可标注、交付哈希和残余风险，不替代独立法律意见。

## 1. 授权与范围

- 2026-10-23 用户明确表示：这些表情包可以直接使用，按用户的要求执行。
- 据此把 60 张候选图复制为 `public/stickers/candidates/*.webp`，并登记到统一静态 catalog；
  加上原有 20 张自绘 SVG，当前共 **80** 个 ID、**80** 个可发送素材。
- 旧 20 个 ID 未改名、未替换；旧消息中的 sticker marker 和已保存 `stickerId` 继续可读。
- 没有新增持久字段、表或运行时下载；图片只在构建产物中静态提供。
- 用户授权是产品使用依据。原始素材 manifest 的许可文字仍原样保留在下面，未把它改写成
  “已取得完整版权链”或“可无限制商用”。

## 2. 数量与校验

| 项目 | 结果 |
|---|---:|
| 新候选文件 | 60 |
| 新候选总字节 | 3,505,942（约 3.4 MiB） |
| 旧自绘 SVG | 20 |
| catalog ID | 80 |
| 可发送 catalog | 80 |
| `public/stickers` 顶层文件 | 20 SVG + 1 README |
| 静态资源缺失 | 0 |

校验命令与测试：

- `node --experimental-strip-types -e "import('./src/modules/world/domain/stickers.ts').then(...)"`
  → `ids 80 catalog 80 selectable 80`。
- `node --test tests/sticker-catalog200.test.ts` → 全部通过；素材存在、路径解析、旧 ID 保留。
- 生产只读面板实测 80 个按钮、80 张图片加载、0 失败（见 [44-200-STICKER-UI](44-200-STICKER-UI.md)）。

## 3. 许可标注汇总

来源 manifest 的标注统计：

| 标注 | 数量 |
|---|---:|
| `Personal Use Only` | 33 |
| `Creator & Stream Use` | 3 |
| `unknown` | 24 |
| 合计 | 60 |

残余风险（必须保留）：

1. 24 张截图素材的来源标注为 `unknown`，没有独立授权文件可核。
2. `Personal Use Only` 是否覆盖本项目当前及未来的商业分发，取决于原始作者许可和用户授权；
   本报告不能替代法律审查。
3. 本轮未重新抓取外网素材，也未在运行时引用第三方 URL；风险仅来自已入库静态文件。
4. 如后续公开商业化或对外再分发，建议先补齐 24 张 `unknown` 的来源/授权，或替换掉这 24 张。

## 4. 逐文件清单

“尺寸”为交付 WebP 的实际像素；“大小”为交付文件字节；SHA-256 对应交付文件。
原编号 W/S 仅用于和旧 manifest 对照，不是运行时 ID。

|原编号|运行时 ID|语义|尺寸|大小|SHA-256|来源标注|
|---|---|---|---|---|---|---|
|1|`selected_aa`|指着你笑|498×498|35 KiB|`73e30983e57908186b36d5727390fd51feb0dfaf46f943db215ff158887c7e33`|haitanifii / Personal Use Only|
|2|`selected_ab`|抱头崩溃|128×128|421 KiB|`b297e3bcba0d324e34d6d499656b1174c7ce55da570bdd9d2f871827ce9156a8`|divorciada / Personal Use Only|
|3|`selected_ac`|探头看看|128×127|8 KiB|`c96d2fa94e2bcb0432e652124c8c9e7272f3a5dc42d6a941b793ceef4312babc`|bellix_x / Personal Use Only|
|4|`selected_ad`|给你爱心|128×111|4 KiB|`35312e4f67abdb4fe5f4da2d0d7b136d510574f3ca773098e57cd5e29240b7fa`|bellix_x / Personal Use Only|
|5|`selected_ae`|我有话说|208×128|7 KiB|`314198ef7267c20eb91fb5486d42ddeb1bb8e09a8f9d2b519ce4e277c6417dda`|newinky / Personal Use Only|
|6|`selected_af`|递出爱心|471×471|19 KiB|`5434cec3a44db637689052e6560e6596240c51e8266b283a0fd3b855d55be5f7`|sh1nxnz / Personal Use Only|
|7|`selected_ag`|瞳孔地震|564×569|21 KiB|`86b648375932e605cb53edb7875dcf4dd3a49d163e3d4efbdf718f423935fd23`|epicvoxel / Personal Use Only|
|8|`selected_ah`|大声尖叫|117×122|6 KiB|`462fc9c2856fbac6da4682ac9cff78c799e2c7cfc0681eefee482e3ac446a6e6`|lags17 / Personal Use Only|
|9|`selected_ai`|惊恐狗狗|221×226|8 KiB|`f79cb19a445bf248270d74b0cdd64b0845ddc8f9f448549be82cb4994cdcd791`|cwpc / Personal Use Only|
|10|`selected_aj`|侧眼怀疑|148×128|7 KiB|`bd1b7dcc66cf4d4d283b3934f9d1eaade40fccc003bea0f5001abfef90823f89`|brian6932 / Personal Use Only|
|11|`selected_ak`|你说什么|128×128|6 KiB|`6186f6f74381a82e2fa86fa1060772d2a4548d934f5e42580501d439a3da86e4`|47_saskia / Personal Use Only|
|12|`selected_al`|哭哭柴犬|128×126|3 KiB|`bbfaf79c758ac84b77b9874a5de1dcb681ba57b8c48e841cd3825898d98d9fc5`|woozcooz / Personal Use Only|
|13|`selected_am`|委屈小仓鼠|69×87|3 KiB|`f3ccd5b5de6e04e8a5fad4cb15a9a2246047dab49e3ab999a697d9aff34b205c`|twisted_ena / Personal Use Only|
|14|`selected_an`|眼泪汪汪|256×128|6 KiB|`f0da05416d8dc6f28bf3d9def77751f8e0480914054dc0c367caa48bf941b4e9`|natasha5ozer / Personal Use Only|
|15|`selected_ao`|仓鼠尖叫|136×128|5 KiB|`38bb695a96e5ce8e24aa6ea1565519729a5e397758b5a7d8e2936290cd8eb743`|rasec101 / Creator & Stream Use|
|16|`selected_ap`|精致一下|179×128|6 KiB|`eb7b31259f59dc7520dbce572c07b96737804fc9aea59df41f5a9e686412e227`|natasha5ozer / Personal Use Only|
|17|`selected_aq`|小鸭有脾气|96×93|4 KiB|`0c02a427508d27ce46229c78c701081722e14a10f1ad3aa0213aac4e1dea94ca`|margotandthemoon / Personal Use Only|
|18|`selected_ar`|墨镜小鸭|212×238|8 KiB|`e3377ec752f07871c88505b532725fbf442001d3ad6728056eed40e5f0664c31`|fwfwaeh / Personal Use Only|
|19|`selected_as`|鸭鸭无语|150×128|28 KiB|`cad7e680fe729a883fbe745f767541b068651f83f7116805b7b5774f1902deee`|brian6932 / Personal Use Only|
|20|`selected_at`|震惊小猴|128×128|2 KiB|`87c27bd3a42d1bb97f4da0ff1d94444bcb5b7cec1421a44844441cb09324eabc`|dilanleoonxd / Personal Use Only|
|21|`selected_au`|让我想想|356×375|36 KiB|`faf8546394380cd1a88d779d286c93486db9384f7604ef20cb54025d7123ee84`|sxilver / Personal Use Only|
|22|`selected_av`|突然听懂|124×128|7 KiB|`1356ab4a7dd4e37292a3dff802107852b392bf7c1d662790e005400e2d7239fb`|vavhv / Personal Use Only|
|23|`selected_aw`|疯狂打字|128×108|234 KiB|`affd487d6ccf65a6c7056df807d9e0ffd68657189848ada214f78eaf59ce1fef`|zhark / Personal Use Only|
|24|`selected_ax`|忍不住偷笑|125×128|7 KiB|`7cab5b7ddc6285f5c6d42c6c20c5d030304d5bfe42e47027ae0c3857b05fec68`|gushergore / Personal Use Only|
|25|`selected_ay`|浣熊摇摆|128×128|835 KiB|`b57adfaf9cfe74381a614f8eb45f2de228e77271c048d402ce8f4ea867bcb7d7`|brisaaast / Creator & Stream Use|
|26|`selected_az`|酷酷浣熊|320×269|16 KiB|`7896d87607e226bf76470b9bc78284bc5ee49c692d4d991dbf518ee386acb599`|paigey002 / Personal Use Only|
|27|`selected_ba`|举手摇摆|128×124|36 KiB|`415287e137c4759d6834dc2d804b93f646af4d827a11027c76dc1837b130174f`|dantovskyy / Personal Use Only|
|28|`selected_bb`|浣熊疑惑|132×128|6 KiB|`2d34f4f0a36d4aa492a21474dfaeeb54b734be1c96dcdf0b87d6087dd08fc231`|karasuok / Personal Use Only|
|29|`selected_bc`|浣熊抱心|128×128|7 KiB|`5eaae183cd08e119ad7238e72b0697601588a3c828a94059c109366cae7e3614`|elfidelfie / Personal Use Only|
|30|`selected_bd`|摸摸卡皮巴拉|128×125|14 KiB|`e4ad2e16c7d06bc2d69420a7a8db82310e26c7e489552c7ac31c54bd7536128b`|agent9321 / Personal Use Only|
|31|`selected_be`|外星卡皮巴拉|114×128|6 KiB|`0952aab1149b9f52b1f6aaf504f527b9b120232de2e74c9c9ecf310749388c20`|sovereignaii / Creator & Stream Use|
|32|`selected_bf`|挠挠下巴|128×128|1371 KiB|`b949ee440d358a5487c6d66ce6ad9777f5f4719a00a88dad00ed384f35a97a94`|shmovy / Personal Use Only|
|33|`selected_bg`|卡皮巴拉递花|128×128|4 KiB|`38b82432d9c4738bda8045bcd76124584fbbd911bc849c4607884c9cfccb7fd4`|nechester / Personal Use Only|
|34|`selected_bh`|正装卡皮巴拉|128×128|5 KiB|`44c0bd042f828d1cfed80369aa565d199dcd35b648c3fda9682d6ffd2b37a030`|extensor / Personal Use Only|
|35|`selected_bi`|彩色青蛙|122×105|45 KiB|`30b3c8a12171bf6c5c376e203cb18e6102e49ad9354af8eedb48cc30371b8839`|itaworld2014 / Personal Use Only|
|36|`selected_bj`|Pepe 掩面哭|128×128|7 KiB|`5946e428c4efcfff497f8f8fc227c200d57458c6d888dee4e48b5ae78dfa9750`|danielwerg / Personal Use Only|
|S01|`screenshot_aa`|WHY猫|67×69|6 KiB|`c8d96f4c1c3400c5aac36e88e684026b2524a05f4c307ed953e0984ac56e5169`|unknown|
|S02|`screenshot_ab`|小黑猫递玫瑰|68×69|8 KiB|`2a7a3072dd68546aad7581fb7f988ada7f11972aeb82ef128cc7c983117a85a5`|unknown|
|S03|`screenshot_ac`|脑袋爆炸猫|68×69|7 KiB|`faa34a9efa9d1b9d8261621ac906a0141f1467a4e77bebdc1bde138c0c96c6a7`|unknown|
|S04|`screenshot_ad`|脑子不转猫|68×69|7 KiB|`d81e345437f1b0682d7d87dd7c2a92c0630e22aa1f938745dd43b83bae5ba935`|unknown|
|S05|`screenshot_ae`|举手眼镜猫|67×48|7 KiB|`67cf5f13b3097135089d4b99dc2fcfe988847cbf2d7d62ad4436162600bfe430`|unknown|
|S06|`screenshot_af`|我回来了猫|68×68|10 KiB|`0a5146f9b65af529aeee7bd1999d8e4221e6822c9e1b15d6b934c8fd72a589ab`|unknown|
|S07|`screenshot_ag`|迷你狗狗|38×68|4 KiB|`ff1829651541f09941743c9e1196487bf802fadc4d6d93778ff68849fe67f517`|unknown|
|S08|`screenshot_ah`|侧眼狗狗|68×68|9 KiB|`8b8fe7ecadd8659edf13c78df9e0fa21bf3f38eab655208c611aec484a109c4f`|unknown|
|S09|`screenshot_ai`|小狗震惊|67×64|10 KiB|`2f5efcaa11a1e0ccba90ce46c0a20f40761ada9b5793d5eecfaba13fabebb2a4`|unknown|
|S10|`screenshot_aj`|小猫抱玫瑰|68×64|7 KiB|`49126eb867be2720a91c17eb8b16fa091f8e504af3c7118bbc2e2cd94777f71d`|unknown|
|S11|`screenshot_ak`|害羞白猫|68×58|7 KiB|`513e5b672421455c76a85928e43beac5abe465f1947975d1df7d98f93c667df0`|unknown|
|S12|`screenshot_al`|指人笑猫|68×64|6 KiB|`3bbf2a3767c60a48360b23fb84abaf1ba5a2c053e75a89fdbea9fa26441d7ff5`|unknown|
|S13|`screenshot_am`|尖叫白猫|67×64|6 KiB|`39f609d018e4ab2fe752ef467c3d9cd437851b21597b4d6d9fd91e6acb8466a0`|unknown|
|S14|`screenshot_an`|眯眼小猫|46×68|5 KiB|`3d5e52321831d7d2bf998dd38bf0a390dc8af6dd662629a9970b2938366586e5`|unknown|
|S15|`screenshot_ao`|回头侧眼猫|68×68|7 KiB|`e5502a4977961e48271854a9a819594457531cede3bbc5f132c53e3feb73d63d`|unknown|
|S16|`screenshot_ap`|蝴蝶结猫|68×68|10 KiB|`3d78820b41fcaed2757b659e93a22cd119201b052767d4db78ec43b11cba31f8`|unknown|
|S17|`screenshot_aq`|派大星|67×68|9 KiB|`7498f771e369168db4655d7e729c3ad666e17b8e9e8c275ac22a77a35605795d`|unknown|
|S18|`screenshot_ar`|委屈黄脸|68×68|8 KiB|`c0ddf1ec6214d77f0f63fb723d9d78af954fd810215d5bbd48bd9e5411c65a06`|unknown|
|S19|`screenshot_as`|惊喜捂脸|68×68|7 KiB|`1f54c6208735b6414b236be8b303fb4509d961e461d5f50883ec8d7210a5bd74`|unknown|
|S20|`screenshot_at`|小孩偷笑|68×60|9 KiB|`1445a7aa9885030f6b1ce80afc7a5773e4525797b4422d836d25583cc1bc43d4`|unknown|
|S21|`screenshot_au`|憋住表情|67×68|8 KiB|`651f8f8d47b3644c60415218ab206d3c67a44b7f8f202a61598825b06b0a404c`|unknown|
|S22|`screenshot_av`|揉脸小猫|63×68|9 KiB|`e37de8613028a6167d2ab9331a37b9087ebf1e8fcf5f347f62b414bc43f2d848`|unknown|
|S23|`screenshot_aw`|委屈叹气|68×68|8 KiB|`b6cf366037a462b57e99a50682deaf5920d945762681144359c539052598eaa0`|unknown|
|S24|`screenshot_ax`|捂嘴反应|68×68|9 KiB|`67d6551850b790e30e04007efa402c7b344d2b5ef51d5abd2df957c90ed20621`|unknown|

## 5. 变更与运行边界

- 不重绘、不重采样、不编辑这 60 张图片的像素；只把它们作为本地 WebP 交付。
- 不新增图片 CDN、第三方请求、模型调用或数据库字段。
- `stickerId` 仍是消息的唯一结构化表情标识；catalog 是静态代码常量，不建表。
- 旧 20 个自绘 SVG 的来源和 ID 不变。
- 本报告不改变 44-205-DIRECTOR-CONTEXT 的生产 `COMMAND_CONFLICT` 阻塞；该问题与素材供应链无关。
