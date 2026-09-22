'use client';
import { BranchList } from '../features/discovery/branch-list.tsx';
import { AppTabs } from './app-tabs.tsx';
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
  const [selected, setSelected] = useState('');
  return (
    <div className="discovery-page">
      <header className="discovery-header">
        <h1 className="outer-title">分支</h1>
      </header>
      <main className="discovery-main">
        <p className="cloud-preview-banner">开发样例 · 不创建世界</p>
        <BranchList
          items={[
            '导演的我',
            '摄影师的我',
            '海边店主的我',
            '东京的我',
            '音乐人的我',
            '这是一条用来验证特别长的身份名称是否会超出卡片边界的分支',
          ].map((title, i) => ({ id: String(i), title, status: '界面样例' }))}
          onOpen={setSelected}
        />
        <p role="status">{selected ? `已选择样例 ${Number(selected) + 1}` : ''}</p>
      </main>
      <AppTabs active="possibilities" />
    </div>
  );
}
