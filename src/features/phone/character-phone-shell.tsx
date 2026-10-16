'use client';
import { PhoneShell, type PhoneShellProps } from './phone-shell.tsx';
import { WechatCharacter } from './wechat-character.tsx';
/** Author trials opt into the same WeChat apps without the device desktop or lock. */
export function CharacterPhoneShell({
  wechatActorKey,
  wechatActorId,
  ...phone
}: PhoneShellProps & { wechatActorKey?: string; wechatActorId?: string }) {
  return wechatActorKey ? (
    <WechatCharacter key={wechatActorKey} actorId={wechatActorId} />
  ) : (
    <PhoneShell {...phone} />
  );
}
