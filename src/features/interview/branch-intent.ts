/**
 * What the user is asking for when they mention a branch in the conversation.
 *
 * The old UI only recognised a handful of "enter this branch" phrasings, so a user who
 * said "帮我建一个分支" or "有什么分支吗" got nothing — the conversation appeared to
 * ignore them. Routing is pure and tested so the three very different actions stay
 * distinct: browsing (show what exists), entering (open the phone) and creating
 * (actually build one).
 */
export type BranchIntent =
  /** Build a branch (and enter it) because the user asked for one. */
  | 'create'
  /** Show / recommend branches without building anything yet. */
  | 'recommend'
  /** A branch or world already exists: open it. */
  | 'enter'
  | 'none';

const CREATE =
  /(帮我|给我|替我|直接|去)?(创建|新建|建立|建一个?|建|生成|开辟)[^。！？,!?]{0,10}(新(的)?|另一(个|种|条))?(分支|平行人生|平行世界|世界分支|人生分支|新世界|另一种人生|另一条路)|(体验|开始|开启)[^。！？,!?]{0,10}(新(的)?|另一(个|种|条))(分支|平行人生|平行世界|世界分支|人生分支|人生|世界)|我想?试试(另一条|这个方向|那条路|新的分支)|我要?试试(另一条|这个方向|新的分支)|就按这个(方向)?(来|建|做)|开始(一段|新的)(人生|平行人生|平行世界|分支)|帮我实现这个|直接创建/;
const ENTER =
  /^(进入|打开|回)(这个|该|已有的|我的)?(手机|世界|平行世界|人生|分支)$|(进入|打开)(我的)?平行手机|(进入|打开)已建好的(世界|分支)|就选这个(分支)?|(进入|体验|开始)(一下)?(这个|这条|该)(分支|平行世界|平行人生)|进入(这个|我的)?(平行)?(人生|世界)|进(入)?手机/;
const RECOMMEND =
  /(有什么|有哪些|有没有|看看|想看|看一下|推荐|帮我推荐|给我看看|推演)(一?[下个])?(我的)?(分支|方向|平行人生|平行世界|另一种可能|另一种人生|另一个可能)|我的平行分支|根据聊天.*(推演|看看)/;

export function routeBranchIntent(text: string): BranchIntent {
  const value = text.trim();
  if (!value) return 'none';
  /* Creating a new branch wins over entering: if the user asks to create and enter, they want a brand-new branch. */
  if (CREATE.test(value)) return 'create';
  if (ENTER.test(value)) return 'enter';
  if (RECOMMEND.test(value)) return 'recommend';
  return 'none';
}

/**
 * Which direction to build when the user asks for a new branch.
 *
 * The bug this exists to prevent: once a life was already built, saying "create a
 * branch" simply reopened that life, because the first ready world always won. A
 * direction that has already produced a life must be skipped, and when nothing is
 * left the caller must ask instead of silently reopening the old one.
 */
export function chooseUnbuiltDirection<T extends { id: string }>(
  directions: T[],
  adopted: Iterable<string>,
  preferredIndex = 0,
): T | null {
  const taken = new Set(adopted);
  const fresh = directions.filter((direction) => !taken.has(direction.id));
  if (!fresh.length) return null;
  const preferred = directions[preferredIndex];
  if (preferred && !taken.has(preferred.id)) return preferred;
  return fresh[0]!;
}

/**
 * The material for a branch request, taken from the conversation itself.
 *
 * The server refuses to generate directions when there is neither a confirmed fact nor
 * a brief (`INVALID_INPUT`), and the UI used to send an empty brief — so asking for a
 * branch right after chatting did nothing at all. The user's own recent words are
 * exactly the brief the planner needs.
 */
export function buildBranchBrief(
  messages: readonly { role: string; text: string }[],
  options: { maxMessages?: number; perMessage?: number; maxChars?: number } = {},
): string {
  const maxMessages = options.maxMessages ?? 4;
  const perMessage = options.perMessage ?? 120;
  const maxChars = options.maxChars ?? 400;
  const recent = messages
    .filter((message) => message.role === 'user')
    .slice(-maxMessages)
    .map((message) => message.text.replace(/\s+/g, ' ').trim().slice(0, perMessage))
    .filter(Boolean);
  const brief = recent.join('；');
  return brief.length > maxChars ? `${brief.slice(0, maxChars - 1)}…` : brief;
}
