'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  PhoneActions,
  PhoneActionReceipt,
  PhoneAppsData,
  PhoneCommandResults,
} from './types.ts';
import { errorText } from './helpers.ts';
export type Operation = {
  busy?: boolean;
  status?: 'accepted' | 'committed' | 'failed';
  error?: string;
  errorCode?: string;
  signature?: string;
  commandId?: string;
  startedResult?: PhoneCommandResults[string];
};
export type NoteDraft = { title: string; text: string; expectedVersion?: number };
type Context = {
  worldId: string;
  data: PhoneAppsData;
  actions: PhoneActions;
  loading: boolean;
  loadError?: string;
  onReload?: () => Promise<void>;
  drafts: Record<string, string>;
  setDraft: (key: string, text: string) => void;
  noteDrafts: Record<string, NoteDraft>;
  setNoteDraft: (key: string, value: NoteDraft) => void;
  clearNoteDraft: (key: string) => void;
  operations: Record<string, Operation>;
  run: (
    key: string,
    signature: string,
    action: (id: string) => Promise<PhoneActionReceipt>,
  ) => Promise<PhoneActionReceipt | undefined>;
};
const AppsContext = createContext<Context | null>(null);
export type PhoneAppsProviderProps = {
  worldId: string;
  data: PhoneAppsData;
  actions?: PhoneActions;
  loading?: boolean;
  loadError?: string;
  onReload?: () => Promise<void>;
  commandResults?: PhoneCommandResults;
  children: ReactNode;
};
export function PhoneAppsProvider(props: PhoneAppsProviderProps) {
  return <WorldApps key={props.worldId} {...props} />;
}
function WorldApps({
  worldId,
  data,
  actions = {},
  loading = false,
  loadError,
  onReload,
  commandResults,
  children,
}: PhoneAppsProviderProps) {
  const [drafts, updateDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, updateNotes] = useState<Record<string, NoteDraft>>({});
  const [operations, updateOps] = useState<Record<string, Operation>>({});
  const opRef = useRef<Record<string, Operation>>({});
  const resultsRef = useRef(commandResults);
  resultsRef.current = commandResults;
  function clearCommittedDraft(key: string, signature?: string) {
    if (key.startsWith('message:'))
      updateDrafts((d) => (d[key] === signature ? { ...d, [key]: '' } : d));
    if (key.startsWith('note:'))
      updateNotes((d) => {
        const id = key.slice(5);
        if (JSON.stringify(d[id]) !== signature) return d;
        const next = { ...d };
        delete next[id];
        return next;
      });
  }
  useEffect(() => {
    for (const [key, operation] of Object.entries(opRef.current)) {
      const terminal = operation.commandId ? commandResults?.[operation.commandId] : undefined;
      if (
        !terminal ||
        terminal === operation.startedResult ||
        operation.busy ||
        operation.status === 'committed'
      )
        continue;
      const error = terminal.status === 'failed' ? errorText({ code: terminal.code }) : undefined;
      if (operation.status === terminal.status && operation.error === error) continue;
      setOp(key, { ...operation, status: terminal.status, error, errorCode: terminal.code });
      if (terminal.status === 'committed') clearCommittedDraft(key, operation.signature);
    }
  }, [commandResults]);
  function setOp(key: string, value: Operation) {
    opRef.current = { ...opRef.current, [key]: value };
    updateOps(opRef.current);
  }
  async function run(
    key: string,
    signature: string,
    action: (id: string) => Promise<PhoneActionReceipt>,
  ) {
    const prior = opRef.current[key];
    if (prior?.busy) return;
    const commandId =
      prior?.signature === signature &&
      prior.status !== 'committed' &&
      !(
        prior.commandId &&
        resultsRef.current?.[prior.commandId]?.status === 'failed' &&
        resultsRef.current?.[prior.commandId]?.code !== 'UNKNOWN'
      )
        ? prior.commandId!
        : crypto.randomUUID();
    const startedResult = resultsRef.current?.[commandId];
    setOp(key, { busy: true, signature, commandId, startedResult });
    try {
      const receipt = await action(commandId);
      if (!receipt || !['accepted', 'committed'].includes(receipt.status))
        throw new Error('Invalid receipt');
      const currentResult = resultsRef.current?.[commandId];
      const terminal = currentResult !== startedResult ? currentResult : undefined;
      if (terminal?.status === 'failed') throw { code: terminal.code };
      const status = terminal?.status ?? receipt.status;
      setOp(key, { status, signature, commandId, startedResult });
      if (status === 'committed') clearCommittedDraft(key, signature);
      return { ...receipt, status };
    } catch (error) {
      setOp(key, {
        status: 'failed',
        error: errorText(error),
        errorCode:
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined,
        signature,
        commandId,
        startedResult,
      });
    }
  }
  return (
    <AppsContext.Provider
      value={{
        worldId,
        data,
        actions,
        loading,
        loadError,
        onReload,
        drafts,
        setDraft: (key, text) => updateDrafts((d) => ({ ...d, [key]: text })),
        noteDrafts,
        setNoteDraft: (key, value) => updateNotes((d) => ({ ...d, [key]: value })),
        clearNoteDraft: (key) =>
          updateNotes((d) => {
            const next = { ...d };
            delete next[key];
            return next;
          }),
        operations,
        run,
      }}
    >
      {children}
    </AppsContext.Provider>
  );
}
export function usePhoneApps() {
  const context = useContext(AppsContext);
  if (!context) throw new Error('PhoneAppView requires PhoneAppsProvider');
  return context;
}
