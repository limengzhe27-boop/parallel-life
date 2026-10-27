# Sticker assets

- `candidates/*.webp`: 60 images published on 2026-10-23 after the user explicitly
  confirmed they may be used directly. Source mapping, licence labels and SHA-256 checksums are in
  [`docs/task-reports/44-200-STICKER-LICENSING.md`](../../docs/task-reports/44-200-STICKER-LICENSING.md).
- The original 20 top-level `*.svg` text/smiley stickers were retired on 2026-10-27; their historical
  messages were converted to text by `db/migrations/0120_retire_text_stickers.sql`.
- All files are static local assets; the app does not fetch sticker images from a remote host.
