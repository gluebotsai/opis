# Manual deploy via GitHub Actions (self-hosted)

Flow: **push code → GitHub → Actions → Manual Deploy (self-hosted) → Run workflow → Deploy**.

## Prerequisites (once on the runner host)

1. Self-hosted runner registered with labels: `self-hosted`, `linux`, `staging`.
2. Install dir exists (default): `/home/worktual/UMN_REBUILD/SGW_IGR/ur-signaling`
3. systemd unit installed (recommended):

```bash
sudo cp deploy/ur-signaling.service /etc/systemd/system/ur-signaling.service
# Edit WorkingDirectory + ExecStart to match install_dir
sudo systemctl daemon-reload
sudo systemctl enable ur-signaling
```

4. Config: `configs/ur-signaling.staging.conf.json` (ports only; host via `UR_SIP_HOST`).  
   **Certificates are not built into the binary.** Place them manually under
   `sip.certificate_dir` / `UR_SIP_CERTIFICATE_DIR` (default `/etc/ur-signaling/certs`):
   - **required:** `agent.pem`, `wss.pem` (`wss.pem` is usually a copy of `agent.pem`)
   - **recommended:** `cafile.pem`  
   Do not commit PEM files. Deploy auto-detects the host IPv4 into `UR_SIP_HOST`
   (override with workflow input / env).
5. **WSS (:57344):** leave **udp_only = false** and **install_wss_sofia = true**.  
   Same cert files as above under `/etc/ur-signaling/certs` (or `UR_SIGNALING_CERT_DIR`).
6. Runner labels must match workflow `runs-on` (default: `self-hosted`, `Linux`, `X64`).

## How Sofia WSS source is obtained

Ubuntu `libsofia-sip-ua` **does not** provide `NUTAG_WSS_URL`.  
`scripts/install-wss-sofia.sh` builds a WSS-capable Sofia into `UR_SOFIA_PREFIX`
(default `${HOME}/.local/sofia-sip-1.13.17` for the runner user, e.g. `nlp_umn`).

**Resolution order** (no manual `SOFIA_SRC` needed on a clean staging host):

1. Explicit `SOFIA_SRC` (workflow input `sofia_src` or env) — must contain `NUTAG_WSS_URL`
2. Local / staging directories (unpacked `third_party/…`, sibling SGW trees,
   `/home/worktual/UMN_REBUILD/...`, cache under
   `${XDG_CACHE_HOME:-$HOME/.cache}/ur-signaling/sofia-sip-1.13.17`)
3. **Unpack** vendored `third_party/sofia-sip-1.13.17.tar.gz` (SGW sources, LGPL-2.1;
   ~4.7 MB in git with generated `configure` — see `third_party/sofia-sip-1.13.17.README.md`)
4. **Download** FreeSWITCH [sofia-sip v1.13.17](https://github.com/freeswitch/sofia-sip/releases/tag/v1.13.17)
   if the vendored tarball is absent (`NUTAG_WSS_URL` is in that fork). Override with
   `SOFIA_SRC_URL` for a team mirror.

Sources lacking `NUTAG_WSS_URL` are rejected. After Actions `rsync`, staging gets the
vendored tarball — no sibling SGW tree required.

Manual fallback (only if the vendored tarball is missing and download is blocked):

```bash
export SOFIA_SRC=/home/worktual/UMN_REBUILD/SGW_IGR/signalinggateway/xg_third_party_libs/sofia-sip-1.13.17
./scripts/install-wss-sofia.sh
```

## How to deploy

1. Push your branch to GitHub.
2. Open the repo → **Actions**.
3. Select workflow **Manual Deploy (self-hosted)**.
4. Click **Run workflow**.
5. Choose branch, then options:

| Input | Typical value |
|-------|----------------|
| `git_ref` | leave empty (uses branch from the dropdown) |
| `install_dir` | `/home/worktual/UMN_REBUILD/SGW_IGR/ur-signaling` |
| `config` | `configs/ur-signaling.staging.conf.json` |
| `sip_host` | leave empty to auto-detect; or e.g. `82.113.92.89` |
| `udp_only` | **false** to listen WSS `:57344` |
| `install_wss_sofia` | **true** (builds Sofia with NUTAG_WSS_URL if missing) |
| `sofia_src` | leave empty (vendored tarball / SGW auto-detect); or absolute path on runner |
| `skip_apt` | true after first successful deploy |
| `use_systemd` | true |

6. Confirm green job **Deploy to staging runner**.

## What the workflow does

1. `actions/checkout` of the selected ref  
2. `rsync` into `install_dir` (keeps local `build/`, `logs/`, `data/`)  
3. Runs `scripts/deploy-self-hosted.sh` (detects `UR_SIP_HOST` → apt → WSS Sofia if needed → build → restart)  
4. Verifies process + UDP `:5060` (+ WSS `:57344` unless `udp_only`)

## Sofia stack debug log (file)

Deploy writes a systemd drop-in `sofia-debug.conf` (no C++ changes):

- **File:** `${INSTALL_DIR}/logs/sofia.err` (override with `SOFIA_LOG_FILE`)
- **Level:** `SOFIA_DEBUG=9` by default, plus `NUA_DEBUG`, `SOA_DEBUG`, `NEA_DEBUG`,
  `IPTSEC_DEBUG`, `NTA_DEBUG`, `TPORT_DEBUG`, `TPORT_LOG`, `TPORT_DUMP=1`,
  `SU_DEBUG`, `NTH_DEBUG` (SIP message / transport dumps on stderr)
- **View:** `tail -f logs/sofia.err`
- **Disable verbose:** `SOFIA_DEBUG=0 ./scripts/deploy-self-hosted.sh` (stderr still appends to the file)

App logs remain in `logs/ur-signaling-staging.log`.

## Optional repo Variables

Settings → Secrets and variables → Actions → **Variables**:

- `UR_SOFIA_PREFIX` — **leave unset** so deploy uses `${HOME}/.local/sofia-sip-1.13.17`
  for the runner user (e.g. `/home/nlp_umn/.local/sofia-sip-1.13.17`).  
  If you set this Variable, it **must** be writable by the runner user (or you need
  passwordless sudo for `make install`). Do **not** set `/root/.local/...` when the
  runner is not root — `/root` is not traversable by `nlp_umn`, and the installer
  will fall back to `$HOME/.local/sofia-sip-1.13.17` with a warning.
- `UR_SIGNALING_CERT_DIR` (default `/etc/ur-signaling/certs`)
- `UR_SIGNALING_SERVICE` (default `ur-signaling`)
- `UR_SIP_HOST` (optional fixed SIP IP; else auto-detect)

## Local fallback (without Actions)

```bash
cd /home/worktual/UMN_REBUILD/SGW_IGR/ur-signaling
# WSS listen (default):
export UR_SIP_UDP_ONLY=0
export INSTALL_WSS_SOFIA=1
# optional: export UR_SIP_HOST=82.113.92.89
# optional: export SOFIA_SRC=/path/to/sofia-sip-1.13.17
./scripts/deploy-self-hosted.sh
ss -ltnp | grep 57344
```
