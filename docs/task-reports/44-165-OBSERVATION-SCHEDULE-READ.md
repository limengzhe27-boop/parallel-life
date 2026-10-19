# 44-165 Observation scheduling read

Owner autonomy-runtime-audit165; root owns server integration/deployment. Base8b9f1207.

New read-only reader returns existing observation candidate identities from committed actor narrative knowledge using the existing source authenticator, consumed-source reader and candidate collector. It checks world/epoch/version, excludes handled actors, protected attempts and already attempted paid/terminal candidate identities. No full Persona/chat hydration, invented message, new model or database write. Missing input receipts cannot hide protected attempts (LEFT JOIN).

It is only a hydration-selection hint: root must retain original scheduler qualification, full selected actor snapshot and kernel. It deliberately does not replace plan/responsibility candidate authorization. Existing fallback continues those sources.

Focused tests3/3 cover stale frame rejection before reads, protected unknown with missing receipt, and empty-knowledge path without hydration. TypeScript passes. Parent integrates into the original server and runs required focused database journey/build. No production writes or paid calls performed here.
