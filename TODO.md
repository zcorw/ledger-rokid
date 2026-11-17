# Receipt review workflow

Existing capture, recognition, authorization and original-upload features were accepted by the owner on 2026-11-17. New code and target-device acceptance are tracked separately.

- [x] R001 Fixed review layout, explicit currency codes and three-action navigation. Zhixu: a91b75cc-2654-49ca-8d1a-6e27df2a5c01. Code-stage checks: syntax, 118 Node tests and native-template Chromium layout checks passed; target-device acceptance pending.
- [ ] R002 User-initiated speech recognition and server-validated candidate corrections. Zhixu: a91b75cc-2654-49ca-8d1a-6e27df2a5c02.
- [ ] R003 Idempotent receipt drafts and website continuation without accounting writes. Zhixu: a91b75cc-2654-49ca-8d1a-6e27df2a5c03.
- [ ] R004 Explicit device accounting authorization, idempotent confirmation and outcome recovery. Zhixu: a91b75cc-2654-49ca-8d1a-6e27df2a5c04.

Each item requires code review and relevant automated checks. New resource-package installation, native speech availability and real-device acceptance remain separate delivery steps.
