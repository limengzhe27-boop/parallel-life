'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  LegacyWorldInventory,
  LegacyMigrationResponse,
} from '../../contracts/legacy-world-migration.ts';
import { LifeClient } from '../api/client.ts';
import { playTapSound } from './audio-feedback.ts';

const BLOCKER_LABELS: Record<string, string> = {
  WORLD_ALREADY_MIGRATED_TO_EPOCH_2: '该世界已经运行于 Epoch 2 新引擎，无需重复迁移。',
  ACTIVE_COMMAND_IN_FLIGHT: '当前有正在提交中的玩家指令，请等待完成后再进行升级。',
  ACTIVE_TASK_IN_FLIGHT: '当前有正在执行中的后台演进任务，请稍等片刻再试。',
  NO_ACTORS_DEFINED: '世界中暂无角色设定，无法初始化 NPC 责任运行时。',
};

export function WorldEngineMigrationModal({
  worldId,
  client: providedClient,
  transport,
  onClose,
  onMigrated,
}: {
  worldId: string;
  client?: LifeClient;
  transport?: typeof fetch;
  onClose: () => void;
  onMigrated?: () => Promise<void>;
}) {
  const [client] = useState(() => providedClient ?? new LifeClient(transport));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<LegacyWorldInventory | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationResult, setMigrationResult] = useState<LegacyMigrationResponse | null>(null);

  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const fetchInventory = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await client.inspectLegacyWorld(worldId);
        if (active) setInventory(result);
      } catch (err: unknown) {
        if (active) {
          setError(
            err instanceof Error ? err.message : '无法获取世界存档审计数据，请核对网络后重试。',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchInventory();
    return () => {
      active = false;
    };
  }, [worldId, client]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !migrating) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, migrating]);

  async function handleMigrate() {
    if (!inventory || migrating) return;
    setMigrating(true);
    setMigrationError(null);
    playTapSound();
    try {
      const res = await client.migrateLegacyWorld(worldId, inventory.version);
      setMigrationResult(res);
      setInventory((current) =>
        current
          ? {
              ...current,
              engineEpoch: res.engineEpoch,
              version: res.worldVersion,
              isEligibleForMigration: false,
              blockers: ['WORLD_ALREADY_MIGRATED_TO_EPOCH_2'],
            }
          : null,
      );
      if (onMigrated) {
        await onMigrated();
      }
    } catch (err: unknown) {
      setMigrationError(
        err instanceof Error ? err.message : '升级迁移失败，原存档未做任何更改，可稍后重试。',
      );
    } finally {
      setMigrating(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !migrating) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="世界引擎与多A帧架构管理"
        style={{
          width: '100%',
          maxWidth: '460px',
          maxHeight: '90vh',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <header
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              ⚡ 世界引擎与多A帧架构管理
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
              存档版本 v{inventory?.version ?? '...'} · ID: {worldId.slice(0, 8)}...
            </p>
          </div>
          <button
            type="button"
            disabled={migrating}
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              color: '#64748b',
              cursor: migrating ? 'not-allowed' : 'pointer',
              padding: '4px 8px',
            }}
            aria-label="关闭管理窗口"
          >
            ✕
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: '#64748b' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔄</div>
              <p style={{ margin: 0, fontSize: '14px' }}>正在审计世界存档与多A帧引擎状态...</p>
            </div>
          ) : error ? (
            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
              }}
            >
              <strong style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                读取存档状态失败
              </strong>
              <p style={{ margin: 0, fontSize: '13px' }}>{error}</p>
            </div>
          ) : inventory ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 引擎架构状态卡片 */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  border:
                    inventory.engineEpoch >= 2 ? '1px solid #bbf7d0' : '1px solid #fed7aa',
                  background: inventory.engineEpoch >= 2 ? '#f0fdf4' : '#fffbeb',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: inventory.engineEpoch >= 2 ? '#16a34a' : '#ea580c',
                      color: '#ffffff',
                    }}
                  >
                    {inventory.engineEpoch >= 2
                      ? 'Epoch 2 · 多A帧Agent运行时'
                      : 'Epoch 1 · 旧版单A帧架构'}
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    引擎代数: Epoch {inventory.engineEpoch}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: '#334155' }}>
                  {inventory.engineEpoch >= 2
                    ? '该世界已全面接入 Epoch 2 多A帧架构，所有 NPC 拥有独立认知步进、责任分发总线与主动改期能力。'
                    : '该存档创建于旧版单A帧架构。升级至 Epoch 2 可为所有 NPC 赋予独立智能体职责与改期能力，同时完整保留所有历史对话、照片与日程。'}
                </p>
              </div>

              {/* 存档资产清单 */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                }}
              >
                <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#475569', fontWeight: 600 }}>
                  📦 存档资产审计清单
                </h4>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '10px',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px' }}>
                    <span style={{ color: '#64748b' }}>👥 角色总数：</span>
                    <strong style={{ color: '#0f172a' }}>{inventory.actorCount} 位</strong>
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px' }}>
                    <span style={{ color: '#64748b' }}>💬 历史消息：</span>
                    <strong style={{ color: '#0f172a' }}>{inventory.messageCount} 条</strong>
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px' }}>
                    <span style={{ color: '#64748b' }}>📅 日程约定：</span>
                    <strong style={{ color: '#0f172a' }}>
                      {inventory.appointmentCount} 项
                      {inventory.openAppointmentsCount > 0 && (
                        <span style={{ color: '#2563eb', fontSize: '12px' }}>
                          {' '}
                          (待赴约 {inventory.openAppointmentsCount})
                        </span>
                      )}
                    </strong>
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px' }}>
                    <span style={{ color: '#64748b' }}>📍 地理场景：</span>
                    <strong style={{ color: '#0f172a' }}>{inventory.placeCount} 处</strong>
                  </div>
                  <div
                    style={{
                      gridColumn: 'span 2',
                      background: '#ffffff',
                      padding: '8px 10px',
                      borderRadius: '8px',
                    }}
                  >
                    <span style={{ color: '#64748b' }}>📝 便签记录：</span>
                    <strong style={{ color: '#0f172a' }}>{inventory.noteCount} 条</strong>
                  </div>
                </div>

                {inventory.actors.length > 0 && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
                      登场角色名单：
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {inventory.actors.map((actor) => (
                        <span
                          key={actor.id}
                          style={{
                            fontSize: '12px',
                            padding: '3px 8px',
                            background: '#ffffff',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            color: '#334155',
                          }}
                        >
                          {actor.name} {actor.hasPersona && '🌟'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 迁移提示或阻碍项 */}
              {migrationResult && (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    background: '#f0fdf4',
                    border: '1px solid #86efac',
                    color: '#166534',
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                    🎉 升级成功！
                  </strong>
                  <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5 }}>
                    世界已无损接入 Epoch 2 多A帧架构，已为 {migrationResult.actorCount} 位角色迁移了{' '}
                    {migrationResult.migratedResponsibilitiesCount} 项智能体职责。
                  </p>
                </div>
              )}

              {migrationError && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    fontSize: '13px',
                  }}
                >
                  ⚠️ {migrationError}
                </div>
              )}

              {inventory.engineEpoch === 1 && inventory.isEligibleForMigration && !migrationResult && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    color: '#1e40af',
                    fontSize: '13px',
                    lineHeight: 1.5,
                  }}
                >
                  🛡️ <strong>升级保障：</strong>
                  全过程在单一事务中执行。升级后将为每位角色生成独立的 A-frame 职责契约，历史所有对话、笔记与约定均严格保留。
                </div>
              )}

              {inventory.blockers.length > 0 &&
                !inventory.blockers.includes('WORLD_ALREADY_MIGRATED_TO_EPOCH_2') && (
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      color: '#92400e',
                      fontSize: '13px',
                    }}
                  >
                    <strong>⚠️ 升级暂缓原因：</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                      {inventory.blockers.map((b) => (
                        <li key={b}>{BLOCKER_LABELS[b] || b}</li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          ) : null}
        </div>

        <footer
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            background: '#f8fafc',
          }}
        >
          {inventory?.engineEpoch === 1 && inventory.isEligibleForMigration && !migrationResult && (
            <button
              type="button"
              disabled={migrating}
              onClick={() => void handleMigrate()}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#2563eb',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: migrating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {migrating ? '正在原子升级迁移中…' : '⚡ 一键升级至 Epoch 2 多A帧引擎'}
            </button>
          )}

          <button
            type="button"
            disabled={migrating}
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: '13px',
              fontWeight: 500,
              cursor: migrating ? 'not-allowed' : 'pointer',
            }}
          >
            {migrationResult ? '完成并返回' : '关闭'}
          </button>
        </footer>
      </div>
    </div>
  );
}
