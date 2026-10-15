# Vexa Lite on the QA server

Vexa Lite runs **inside** `deploy/docker-compose.yml` on the CRM network (`vexa-lite`, gateway `http://vexa-lite:8056`). It is not a separate host service on port 18056.

`deploy/deploy.sh` (GitHub Actions → Deploy QA) does the same wiring as local `scripts/up-meeting-docker.sh`:

1. Starts `vexa-postgres`, `vexa-minio`, and `vexa-lite` with the CRM stack.
2. Copies `meeting-service/patches/vexa-live-pcm-forward.ts` into the running `vexa-lite` container so Meet audio reaches meeting-service. Stock `vexaai/vexa-lite` does not include that forwarder. Customer assist and internal assist both depend on those transcripts.
3. Sets `VEXA_API_BASE=http://vexa-lite:8056` and copies `VEXA_API_KEY` from `/run/vexa/key.env` into `deploy/.env`.
4. Recreates `meeting-service` and `meeting-worker` so they load that key.

Admit **Worktual Notetaker** in the Meet lobby. A bot that joined before the patch does not pick up live audio; admit again after deploy.

The standalone scripts `deploy/scripts/up-vexa-lite-server.sh` and `deploy/scripts/vexa-lite-docker-up.sh` are the old host-published path (`18056`). Do not use them while the compose service is running — `deploy.sh` removes a non-compose container named `vexa-lite` so the stack can own that name.
