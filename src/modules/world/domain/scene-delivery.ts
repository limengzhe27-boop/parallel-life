import { DomainError } from './errors.ts';

/** Dialogue is produced after the director's observation; silence cannot pre-empt it. */
export function assertSceneDialogueConsistency(input: {
  narration: string;
  observation: string | null;
  dialogues: readonly { actorId: string; text: string }[];
}): void {
  if (!input.dialogues.some((d) => d.text.trim())) return;
  if (
    /(?:无人|没人|没有人).{0,12}(?:回应|回答|答话|应答)|(?:没有|未|尚未|并未).{0,12}(?:得到|获得|听到).{0,8}(?:回应|回答|答复|应答)/u.test(
      input.narration + '\n' + (input.observation ?? ''),
    )
  )
    throw new DomainError('INVALID_PROPOSAL', 'Scene silence contradicts current dialogue');
}

/** Small visible delivery is separate from performed task actions and grants no progress. */
export function sceneDeliveryText(
  actor: { name: string },
  delivery: unknown,
  otherActorNames: readonly string[] = [],
): string | null {
  if (delivery === undefined || delivery === null) return null;
  if (typeof delivery !== 'string' || !delivery.trim() || delivery.trim().length > 240)
    throw new DomainError('INVALID_PROPOSAL', 'Invalid scene delivery');
  const value = delivery.trim();
  if (
    /内心|心里|暗自|意识到|想着|猜想|心理|期待|希望|担心|焦虑|觉得|决定|完成|签收|支付|付款|转账|收款|交付|接收|接过|收下|检修|复检|核对|检查(?:完|过|了)|奖励|答应|同意|批准|离开现场|到达.{0,10}(?:家|店|场)|你(?:已经|开始|决定|拿|走|伸|点头|答应)/u.test(
      value,
    ) ||
    otherActorNames.some((name) => name !== actor.name && value.includes(name))
  )
    throw new DomainError('INVALID_PROPOSAL', 'Delivery cannot invent decisions or task execution');
  if (value.startsWith(actor.name)) return value;
  return actor.name + (value.startsWith('我') ? value.slice(1) : value);
}

/** A bare ordinary question is already saved speech, never a completed physical task. */
export function isSimpleSceneQuestion(
  action: {
    intent: string;
    kind: string;
    text: string;
    relatedMatterIds: readonly string[];
  },
  allowUnstructuredLinks = false,
): boolean {
  return (
    action.intent === 'attempt' &&
    action.kind === 'try' &&
    (allowUnstructuredLinks || !action.relatedMatterIds.length) &&
    /(?:吗|呢|么|[？?])\s*[？?。！!]*$/u.test(action.text.trim()) &&
    !/然后|接着|之后|如果|假如|假设|我把|我拿|我走|我打开|我烧|我修|我递|我交|我签|我付|我转账/u.test(
      action.text,
    )
  );
}
