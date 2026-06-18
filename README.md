# n8n-nodes-unifi

An [n8n](https://n8n.io) community node for Ubiquiti **UniFi** switches and networks.

It targets the **official UniFi Network API** and, for capabilities the official
API does not expose, **transparently falls back to the legacy controller API** —
the user picks an action and the node decides which API to call.

## How the transparent fallback works

There is one credential. It always needs an **API key** (official API). For the
handful of actions only available in the legacy controller, it also needs a
**local UniFi account** (username + password). When an action needs the legacy
API and no local account is configured, the node fails with a clear message
telling the user exactly what to add — nothing else surfaces the difference.

Cross-API identifiers are reconciled automatically:

| Concept | Official API | Legacy API | How the node bridges them |
| --- | --- | --- | --- |
| Site | `id` | site code | official site object exposes `internalReference` (the legacy code) |
| Device | `id` + `macAddress` | `_id` | matched by **MAC address** |

## Actions

| Resource | Action | API used |
| --- | --- | --- |
| Device | Get / Get Many / Get Statistics / Restart | Official |
| Device | Adopt / Forget / Upgrade Firmware | Legacy (local account) |
| Port | Get Many / Power Cycle PoE | Official |
| Port | Set PoE Mode / Set Port Override (advanced) | Legacy (local account) |
| Client | Get / Get Many / Authorize Guest / Unauthorize Guest | Official |
| Client | Block / Unblock | Legacy (local account) |
| Network (VLAN) | Get / Get Many / Create / Update / Delete | Official |
| Firewall Policy | Get / Get Many / Create / Update / Update (Partial) / Delete / Get + Set Ordering | Official |
| Firewall Zone | Get / Get Many / Create / Update / Delete | Official |
| ACL Rule | Get / Get Many / Create / Update / Delete / Get + Set Ordering | Official |
| DNS Policy | Get / Get Many / Create / Update / Delete | Official |
| Traffic Matching List | Get / Get Many / Create / Update / Delete | Official |
| WiFi Broadcast | Get / Get Many / Create / Update / Delete | Official |
| Hotspot Voucher | Get / Get Many / Create / Delete | Official |
| Switch LAG / MC-LAG Domain / Switch Stack | Get / Get Many | Official (read-only) |
| WAN / RADIUS Profile / VPN Server / Site-to-Site Tunnel / Device Tag | Get Many | Official (read-only) |
| Pending Device / DPI Application / DPI Category / Country | Get Many | Official (read-only, not site-scoped) |
| Custom / Raw | Custom API Call / Connector Passthrough | Official **or** Legacy (you choose) |

**Custom / Raw** is the escape hatch for anything not modeled above:
- *Custom API Call* — pick the API (official or legacy), method, path, query, and
  body, and call any endpoint directly.
- *Connector Passthrough* — proxies a request to a connected console via the
  official `connector/consoles/{id}/*path` endpoint.

> The resources above the Network row are hand-written (they need bespoke fields
> and the legacy fallback). Everything from Firewall Policy down is driven by a
> small registry in `genericResources.ts` — create/update take a raw JSON body,
> so adding or adjusting a resource is a one-line registry edit.

> Legacy port config uses read-modify-write of the device's `port_overrides`
> array — the node reads the current device, merges your change into the matching
> port entry, and writes the whole array back.

## Trigger node

The official API has no webhooks, so **UniFi Trigger** polls and diffs against
workflow static data between runs. Pick an event:

| Event | Cost | Notes |
| --- | --- | --- |
| Device State Changed | 1 list call | Fires on online/offline/state transitions; payload includes `previousState` |
| Firmware Update Available | 1 list call | Fires once when `firmwareUpdatable` first becomes true |
| New Client Connected | 1 list call | First poll seeds the baseline silently; later new clients fire |
| Port Link Changed | 1 detail call **per device** | Use the **Device** filter to scan one switch; payload includes `previousState` |
| PoE Fault | 1 detail call **per device** | Fires when a PoE-enabled port transitions to `DOWN`/`LIMITED` |

To avoid a flood on the very first run, change-detection events seed their
baseline on the first poll and emit nothing until something actually changes.
A manual/test execution instead returns a current snapshot so you can see data.

## UniFi Protect (action node)

A separate node for the **UniFi Protect** API (cameras, sensors, sirens, etc.).
It reuses the same credential (the API key works for both services) but targets
`/proxy/protect/integration`. Like the Network node's extra resources, it is
registry-driven, so adding a resource is a one-line table edit.

| Resource | Operations |
| --- | --- |
| Camera | Get / Get Many / Update, **Get Snapshot** (binary), **PTZ Go To Preset**, Start/Stop Patrol, Create Talkback Session, Disable Mic |
| Siren | Get / Get Many / Update, Play, Stop, Test Sound |
| Speaker | Get / Get Many / Update, Test Sound |
| Relay | Get / Get Many / Update, Activate Output (on/off/toggle, pulse) |
| Alarm Hub | Get / Get Many / Update, Trigger Output (enable/delay/duration) |
| Arm Profile | Get Many / Create / Update / Delete, **Enable (All)**, **Disable (All)**, Update Settings |
| Light / Sensor / Chime / Bridge / Fob / Link Station / Viewer | Get / Get Many / Update |
| Liveview | Get / Get Many / Create / Update |
| NVR / User / ULP User | Get / Get Many (read-only) |

**Get Snapshot returns binary** — the image lands in a binary field (default
`data`), ready to attach to an email, upload to storage, or send to Slack. Every
other operation returns JSON.

Example flows that close the loop with the trigger below:

- **Protect Trigger** (motion) → **Camera: Get Snapshot** → email/Slack the image
- After-hours motion → **Siren: Play** + **Light: Update** (on) + **Camera: PTZ Go To** driveway preset
- **Network** switch-port-down → **Camera: Get Snapshot** of that area → attach to a Jira ticket

> The published Protect spec mislabels its server as the Network base; this node
> correctly uses `/proxy/protect/integration`. Snapshot quirks (channel,
> highQuality) are exposed as fields.

## UniFi Protect Trigger (webhook)

A separate **webhook** trigger node for UniFi Protect's Alarm Manager. Protect
sends alarms *outbound* to a URL you provide, so this node simply listens — there
is nothing to register against UniFi.

Setup: copy the node's **Production URL** into UniFi Protect → Alarm Manager →
add a Webhook action, and select the matching HTTP method.

| Setting | Purpose |
| --- | --- |
| HTTP Method | `POST` (JSON body) or `GET` (query string) — must match Protect |
| Authentication → Secret Header | Add a custom header in Protect and verify it here; spoofed requests get `403` |
| Trigger Keys | Comma-separated allow-list matched against `alarm.triggers[].key` (e.g. `motion,smartDetectZone`); empty = all |
| Ignore Empty Alarms | Acknowledge but don't trigger on payloads with no `alarm` (health checks) |

Example payload emitted to the workflow:

```json
{
  "alarm": {
    "name": "Front door motion",
    "conditions": [{ "condition": { "type": "is", "source": "motion" } }],
    "triggers": [{ "key": "motion", "device": "74ACB99F4E24" }]
  },
  "timestamp": 1722526793954
}
```

> Note: Protect webhooks aren't cryptographically signed — the only built-in
> protection is the custom secret header. The device in `triggers[].device` is a
> MAC; pair this trigger with the action node's **Custom API Call** (Protect API)
> if you need to enrich it with camera details.

## Build & install

```bash
npm install
npm run build
# link into your n8n custom nodes folder:
mkdir -p ~/.n8n/custom && ln -s "$PWD" ~/.n8n/custom/n8n-nodes-unifi
# restart n8n
```

## Running in Docker

Community nodes don't need to be "verified" to run — self-hosted n8n loads any
package you point it at (`N8N_COMMUNITY_PACKAGES_ENABLED=true`, the default). Two
ways to run this one, both included in the repo.

**Option B — mount the built package (fast dev loop):**

```bash
npm install && npm run build      # produces dist/
docker compose up                 # uses docker-compose.yml
```

The repo is mounted read-only at `/opt/n8n-nodes` and exposed via
`N8N_CUSTOM_EXTENSIONS`; n8n reads `package.json`'s `n8n` field and loads the
compiled nodes from `dist/`. Rebuild + `docker compose restart` to pick up
changes (n8n only loads nodes at startup).

**Option A — bake into a custom image (reproducible deploys):**

```bash
docker build -t n8n-unifi .       # multi-stage: compiles the package, then installs it
docker run -it --rm -p 5678:5678 -v n8n_data:/home/node/.n8n n8n-unifi
```

The `Dockerfile` installs the package to `/opt/n8n-nodes` (outside `~/.n8n`) so a
persisted data volume can't shadow it. You can also switch `docker-compose.yml`
to this image by uncommenting `build: .`.

> Both require a successful `npm run build` first. The container runs as user
> `node` (uid 1000) — ensure mounted files are readable by it. Restart the
> container after installing/mounting, since nodes load at startup.

## Lint & publish

```bash
npm run typecheck   # tsc --noEmit (compiler check)
npm run lint        # eslint-plugin-n8n-nodes-base (community-node rules)
npm run format      # prettier
npm publish         # runs prepublishOnly: build + lint, publishes dist/ only
```

Before publishing, update the placeholder `repository`/`homepage`/`bugs` URLs in
`package.json` to your actual GitHub repo.

## Credential setup

- **Host** — console IP/hostname, no protocol (e.g. `192.168.1.1`)
- **API Key** — Settings → Control Plane → Integrations
- **Local Username/Password** — only for legacy actions
- **Ignore SSL Issues** — usually on for local consoles (self-signed certs)

## Known caveats (scaffold)

- The legacy login path (`/api/auth/login`) and CSRF header handling target
  UniFi OS consoles (UDM/Cloud Key Gen2+). A standalone/older controller may
  need a different login path or port.
- Per-port traffic counters are **not** in the official statistics endpoint;
  only port link/PoE state (device detail) and device CPU/mem/uptime are exposed.
- `Set Port Override` field names (e.g. `forward`, `native_networkconf_id`,
  `poe_mode`) come from the legacy schema and should be validated against your
  firmware.

Generated from the UniFi Network API spec (v10.3.58) in `ui-openapi-spec`.
