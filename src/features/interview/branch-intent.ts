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

const ENTER =
  /(开始|开启|进入|体验|就选|选)(一下)?(这个|这条|该)?(分支|平行人生|平行世界)|进入(这个|我的)?(平行)?(人生|世界)|进(入)?手机/;
const CREATE =
  /(帮我|给我|替我)?(创建|建立|建|生成|开|做)(一|个|一条|这)?(个|条)?(分支|平行人生|平行世界|另一种人生|另一条路)|我想?试试(另一条|这个方向|那条路)|我要?试试(另一条|这个方向)|就按这个(方向)?(来|建|做)|开始(一段|新的)?(人生|平行人生)|帮我实现这个/;
const RECOMMEND =
  /(有什么|有哪些|有没有|看看|想看|看一下|推荐|帮我推荐|给我看看|推演)(一?[下个])?(我的)?(分支|方向|平行人生|平行世界|另一种可能|另一种人生|另一个可能)|我的平行分支|根据聊天.*(推演|看看)/;

export function routeBranchIntent(text: string): BranchIntent {
  const value = text.trim();
  if (!value) return 'none';
  /* Entering an existing branch wins: it costs nothing and is what the user asked for. */
  if (ENTER.test(value)) return 'enter';
  if (CREATE.test(value)) return 'create';
  if (RECOMMEND.test(value)) return 'recommend';
  return 'none';
}
