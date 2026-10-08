'use client';
import { Button, Modal } from '../../components/ui.tsx';
import type { ApprovedSeed } from '../../contracts/seeds.ts';
export function SeedReceipt({
  seed,
  onClose,
  children,
  ready = false,
}: {
  seed: ApprovedSeed;
  onClose: () => void;
  children?: React.ReactNode;
  ready?: boolean;
}) {
  return (
    <Modal open title="这个想法，记下了" className="seed-modal" onClose={onClose}>
      <details className="seed-story">
        <summary>{seed.story.title}</summary>
        <p>{seed.story.premise}</p>
        <p>{seed.story.opening}</p>
        <small>{seed.story.tradeoff}</small>
      </details>
      <div className="seed-receipt-details">
        {seed.setup?.identity && <p>你是：{seed.setup.identity}</p>}
        {seed.setup?.place && <p>地点：{seed.setup.place}</p>}
        {seed.setup?.tone && <p>氛围：{seed.setup.tone}</p>}
        <h3>带入的资料</h3>
        {seed.facts.length ? (
          <ul>
            {seed.facts.map((f) => (
              <li key={f.factId}>{f.value}</li>
            ))}
          </ul>
        ) : (
          <p>未带入个人特征资料。</p>
        )}
        {!!seed.events?.length && (
          <>
            <h3>带入的经历</h3>
            <ul>
              {seed.events.map((event) => (
                <li key={event.eventId}>
                  {event.date} {event.title}
                </li>
              ))}
            </ul>
          </>
        )}
        <h3>照片与人物</h3>
        <p>
          {seed.portraitAssetId ? '包含本人照片' : '未带入本人照片'}；
          {seed.people.length ? seed.people.map((p) => p.name).join('、') : '未带入重要人物'}。
        </p>
        {'personRoles' in seed && !!seed.people.length && (
          <ul>
            {seed.people.map((person) => (
              <li key={person.id}>
                {person.name}（现实关系：{person.relationship}）
                <br />
                本分支角色：
                {seed.personRoles?.find((r) => r.personId === person.id)?.role ??
                  '由故事安排虚构角色'}
                {person.assetId && '；照片会用于角色头像和相册'}
                {person.interaction && (
                  <p>
                    我的描述：{person.interaction.slice(0, 600)}
                    {person.interaction.length > 600 && '…'}
                  </p>
                )}
                {!!person.experiences?.length && (
                  <small>
                    前{Math.min(3, person.experiences.length)}
                    段共同经历作为背景，不代表在分支已经发生。
                  </small>
                )}
              </li>
            ))}
          </ul>
        )}
        <p>{ready ? '世界已生成。' : '设定已保存。'}之后修改现实档案，不会自动改变这里。</p>
      </div>
      {children}
      <div className="form-actions">
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}
