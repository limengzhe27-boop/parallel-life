'use client';
import { WorkspaceShell } from './workspace-shell.tsx';
import { useState } from 'react';
import { Brand, Button, Icon, Modal, Notice } from './ui.tsx';
export function UiPreview() {
  const [open, setOpen] = useState(false);
  return (
    <main className="preview">
      <Brand />
      <h1>界面组件预览</h1>
      <p>仅供开发验收，不含模拟聊天或用户档案。</p>
      <div className="row">
        <Button onClick={() => setOpen(true)}>
          打开编辑窗口
          <Icon name="edit" />
        </Button>
        <Button variant="secondary">次要操作</Button>
        <Button variant="ghost">轻操作</Button>
        <Button disabled>等待完成</Button>
      </div>
      <label className="form-label">
        资料内容
        <input className="field" placeholder="写一点关于你" />
      </label>
      <Notice>操作失败时，内容会保留在这里。</Notice>
      <Notice tone="info">
        <span className="spinner" />
        正在读取
      </Notice>
      <Modal open={open} onClose={() => setOpen(false)} title="编辑资料">
        <label className="form-label">
          内容
          <input className="field" autoFocus />
        </label>
        <Button onClick={() => setOpen(false)}>保存并关闭</Button>
      </Modal>
    </main>
  );
}

export function ShellPreview() {
  return (
    <WorkspaceShell
      profile={
        <div className="shell-profile">
          <p className="eyebrow">YOUR REAL LIFE</p>
          <h2>现实中的我</h2>
          <p>你的经历、兴趣和愿望，会慢慢在这里留下轮廓。</p>
          <Button variant="secondary">资料操作</Button>
        </div>
      }
      footer={
        <div className="shell-composer">
          <textarea className="field" aria-label="输入内容" placeholder="写一点此刻的想法…" />
          <div className="form-actions">
            <Button>
              继续
              <Icon name="arrow" />
            </Button>
          </div>
        </div>
      }
    >
      <div className="shell-welcome">
        <p className="eyebrow">EVERY POSSIBILITY BEGINS WITH YOU</p>
        <h1>
          从你的人生，
          <br />
          开始另一种可能。
        </h1>
        <p>不用急着想好要去哪里。先从最近的生活，或者一个一直没说出口的愿望聊起。</p>
      </div>
    </WorkspaceShell>
  );
}
