# Multica workflow configuration

`workflow-steps.json` is an array accepted by `multica workflow create --steps-file`. The installed CLI accepts `status_key`, `new_status`, `handler`, `instructions`, and `next_status_key` on steps. `new_status` accepts `name` and `category`. `handler` accepts `type` and `id` or a name resolvable by the server.

Create the workflow manually with a command shaped like:

```sh
multica workflow create \
  --name "RAGED GitHub Issue Pipeline" \
  --description "GitHub issue intake and bounded implementation pipeline" \
  --steps-file automation/multica/workflow-steps.json
```

Configure each handoff with `multica workflow handoff set` using the real flags:

- `--handler`
- `--instructions-file`
- `--next`
- `--back`

The instruction files are in `automation/multica/handoffs/`.

Webhook secret configuration is manual: set the secret in Multica, store the URL only in the GitHub Actions `MULTICA_WEBHOOK_URL` secret, and rotate/revoke through the Multica UI or API. See `docs/automation/OPERATIONS.md`.
