import { authenticated, endpoint, json } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';

export const runtime = 'nodejs';

/**
 * AUD-20: 个人数据全量导出 (GDPR 数据可携权)
 * 允许用户将自己在当前平台沉淀的全部档案事实、经历事件、访谈对话历史以及平行世界摘要
 * 一键导出为结构化 JSON，供用户离线保存或迁移备份。
 */
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);

    const [profile, workspace, buildsList] = await Promise.all([
      s.profile.get(s.ownerId).catch(() => null),
      s.interview.get(s.ownerId).catch(() => null),
      s.builds.list(s.ownerId).catch(() => []),
    ]);

    const exportBundle = {
      exportedAt: new Date().toISOString(),
      formatVersion: '1.0.0',
      ownerId: s.ownerId,
      profile: profile ?? null,
      interview: workspace?.interview ?? null,
      builds: buildsList ?? [],
    };

    const response = json(exportBundle);
    response.headers.set(
      'Content-Disposition',
      `attachment; filename="parallel-life-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return response;
  });
}
