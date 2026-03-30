# conduit-node

`conduit-node` is the Bun agent installed onto an existing Vultr edge server.

## Required environment

- `CONDUIT_CONTROLLER_URL`
- `CONDUIT_REGISTRATION_TOKEN` on first boot only
- `CONDUIT_NODE_LABEL`
- `CONDUIT_VULTR_INSTANCE_ID`
- `CONDUIT_VULTR_REGION`

Optional:

- `CONDUIT_STATE_DIR` defaults to `/var/lib/conduit-node`
- `CONDUIT_HEARTBEAT_SECONDS` defaults to `15`
- `CONDUIT_JOB_POLL_SECONDS` defaults to `10`
- `CONDUIT_NODE_VERSION` defaults to `0.1.0`

## Runtime contract

- Persists `nodeId` and `agentToken` under `CONDUIT_STATE_DIR`.
- Polls the controller for work.
- Writes FRPS config files under `CONDUIT_STATE_DIR/frps`.
- Runs FRPS containers with Docker host networking and labels them as Conduit-managed.

## Start

```bash
bun install
bun run start
```
