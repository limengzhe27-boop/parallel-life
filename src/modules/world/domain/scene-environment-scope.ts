/** Ephemeral scene narration permissions, derived from authorized place/history only. */
export type SceneEnvironmentScope = {
  area: 'public_service' | 'public_shared' | 'private' | 'unspecified';
  interaction: 'optional_anonymous_service' | 'established_history_only';
  suggestedRoles: string[];
  restriction: 'private_area' | 'not_open' | 'explicitly_unstaffed' | 'explicitly_empty' | null;
};

type EnvironmentPlace = { name: string; description: string };

// These are capability/setting boundaries, not proof that any person is present.
// In particular a hotel room never inherits the service desk's interaction scope.
export function sceneEnvironmentScope(
  place: EnvironmentPlace,
  visibleHistory: readonly string[],
): SceneEnvironmentScope {
  const text = `${place.name}\n${place.description}`;
  const publicDesk = /前台|接待区|接待大厅|服务台|门诊大厅|大厅|大堂/.test(text);
  const privateArea =
    /卧室|客房|酒店房间|酒店套房|病房|出租屋|宿舍|私人|住宅|家中|办公室|包间|包厢/.test(text);
  const service =
    /酒店|宾馆|旅馆|餐厅|餐馆|饭店|咖啡|酒馆|酒吧|商店|便利店|超市|商场|医院|门诊|银行|售票厅/.test(
      text,
    );
  // An explicit room/office in the name beats a generic public building in its description.
  const namedPrivate = /卧室|客房|房间|套房|病房|出租屋|宿舍|家中|办公室|包间|包厢/.test(
    place.name,
  );
  const area: SceneEnvironmentScope['area'] =
    namedPrivate || (privateArea && !publicDesk)
      ? 'private'
      : service || publicDesk
        ? 'public_service'
        : /街道|街边|广场|公园|走廊|操场|车站|地铁|停车场/.test(text)
          ? 'public_shared'
          : 'unspecified';
  let restriction: SceneEnvironmentScope['restriction'] =
    area === 'private' ? 'private_area' : null;
  const unstaffed = /无人值守|无人售货|全自助|没有工作人员|无工作人员/.test(text);
  const notOpen = /(?:已|正在|已经)?(?:打烊|停业|歇业|废弃|暂停营业|尚未营业|还未营业|禁止进入)/;
  // A later saved observation may supersede a previous closure, never a private-area boundary.
  let closed = notOpen.test(text) && !/(?:没有|还没|尚未|并未|并非)打烊/.test(text);
  let empty = false;
  for (const entry of visibleHistory) {
    if (/(?:已经|重新|恢复|正常|正在)营业|已经开门营业/.test(entry)) closed = false;
    if (notOpen.test(entry) && !/(?:没有|还没|尚未|并未|并非)打烊/.test(entry)) closed = true;
    if (
      /空无一人|(?:现场|大厅|大堂|屋里|房间里|这里)(?:现在|此时|仍然|确实)?(?:没有人|没人)|没有任何人|只剩(?:下)?你一人/.test(
        entry,
      )
    )
      empty = true;
  }
  if (!restriction) {
    if (closed) restriction = 'not_open';
    else if (unstaffed) restriction = 'explicitly_unstaffed';
    else if (empty) restriction = 'explicitly_empty';
  }
  const allowed = area === 'public_service' && restriction === null;
  const suggestedRoles = !allowed
    ? []
    : /酒店|宾馆|旅馆/.test(text)
      ? ['前台工作人员']
      : /医院|门诊/.test(text)
        ? ['导诊或服务台工作人员']
        : /餐厅|餐馆|饭店|咖啡|酒馆|酒吧/.test(text)
          ? ['店员或服务员']
          : /商店|便利店|超市|商场/.test(text)
            ? ['店员或服务台工作人员']
            : ['服务台工作人员'];
  return {
    area,
    interaction: allowed ? 'optional_anonymous_service' : 'established_history_only',
    suggestedRoles,
    restriction,
  };
}
