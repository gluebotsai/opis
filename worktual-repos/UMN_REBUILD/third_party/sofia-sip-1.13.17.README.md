# Sofia-SIP 1.13.17 (WSS-capable)

Vendored source used by `scripts/install-wss-sofia.sh` when `INSTALL_WSS_SOFIA=1`.

- **Origin:** SGW tree `signalinggateway/xg_third_party_libs/sofia-sip-1.13.17`
  (WSS-capable; includes generated `configure` + `packages/Makefile.in`).
  Do not re-vendor from bare `signalinggateway/sofia-sip/sofia-sip-1.13.17`
  without running `autoreconf -fi` first — that tree lacks Automake inputs.
- **Why vendored:** Ubuntu `libsofia-sip-ua` lacks `NUTAG_WSS_URL`, which ur-signaling
  needs for WSS listen on `:57344`. FreeSWITCH sofia-sip 1.13.17 also has the tag; this
  tarball is the SGW-proven tree so staging works offline after `rsync`.
- **License:** LGPL-2.1 (`COPYING` inside the tarball).
- **Artifact:** `sofia-sip-1.13.17.tar.gz` — complete SGW tree including generated
  `configure` and `packages/Makefile.in` (not a bare git checkout). Unpacked at
  install time under `${XDG_CACHE_HOME:-$HOME/.cache}/ur-signaling/sofia-sip-1.13.17`
  (or `SOFIA_CACHE_DIR`). Do not commit the unpacked tree (gitignored).
  `install-wss-sofia.sh` runs `autogen.sh`/`autoreconf -fi` when those files are
  missing, and falls back to FreeSWITCH v1.13.17 download if the vendored archive
  cannot satisfy configure prerequisites.

Override with `SOFIA_SRC=/path/to/sofia-sip-1.13.17` if needed. See
`docs/deploy-self-hosted.md`.
