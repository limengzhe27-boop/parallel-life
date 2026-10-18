# 44-158-UI-RECEIPT-LATENCY

Owner: codex-opening-fix-ui158. Integrator: root. Base: 09a96362.
Worktree: /Users/limengzhe/.codex/worktrees/chat-receipt158-ui/人生剧本
Branch: codex/chat-receipt158-ui.

## Scope and behavior

Only world-phone-app.tsx, NEW phone/send-projection.ts, NEW tests/send-projection.test.ts and this report.

The original send awaits a definitive committed NPC receipt. Once received, its local player message becomes sent and send processing returns immediately. A separate readonly world projection request does not prolong send busy, cannot invoke interrupted-build task recovery, and cannot turn committed delivery into a send failure. The confirmed player bubble remains until the exact eventId_user projection appears; matching older text, another actor, an NPC message or an uncertain send does not consume it. No NPC reply is fabricated.

A receipt-derived confirmed version is retained separately from the displayed snapshot so another explicit player send can use that confirmed version while projection catches up. This does not pretend a partial snapshot is a newer complete world. Foreign world/actor/command receipts fail identity validation. Existing immutable commands and unknown fencing are unchanged.

Clock startConversation handshake is deliberately preserved. Same-focus optimization would require a separate scope in use-world-time.ts to verify current lease, focus and resume state, so this task does not skip it.

## Necessary checks

- Focused send-projection/chat-send-error/restored-send-receipts: 18/18 passed.
- npx tsc --noEmit: passed.
- Prettier and git diff --check: passed.
- No model calls, production writes, browser sessions, SQL migrations or independent deployment.

## Remaining integration acceptance

Root must run required combined check/build and deploy, then mobile/PC UI acceptance. This change shortens post-commit UI waiting; it does not reduce the actual NPC model generation duration or prove natural opening/media quality. Root owns event-scoped outbox and Director/NPC protocol work.
