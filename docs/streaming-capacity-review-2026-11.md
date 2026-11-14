# Togetherly — streaming integrations, costs and capacity review

**Reviewed:** 2026-11-14. **Basis:** Current `main` server/client code, the connected Render service's plan and limited metrics, and current publicly available service documentation. This is not a load-test result or legal opinion.

## Current architecture
- **Render:** `togetherly` web service `srv-dbsb34k9v7es73c7a4dg`, confirmed `free` service plan in Oregon, Node/Express 4 and Socket.IO 4.
- **No persistent storage:** the server holds the `rooms`, `searchCache`, `searchRates`, and `rtcHits` maps entirely in process memory.
- **Room ID:** 24 hexadecimal characters generated from 12 random bytes. Any valid-looking ID can create a room when joined, even if that room did not exist before.
- **Room cap:** `MAX_ROOM_PARTICIPANTS=8`; `MAX_CAMERA_PARTICIPANTS=2`; shared queue at most **20** entries; per-room chat keeps at most **80** messages.
- **Total room cap:** **none** in the application; actual safe concurrency is unknown until stress-tested. A socket normally has one active room at a time.
- **Cleanup:** rooms are removed after they have been empty for approximately 12 hours, checked every 30 minutes. All active sessions, messages, queues and playback state are lost after a process restart, sleep, or redeploy.
- **Video delivery:** YouTube video is streamed by YouTube directly to each participant. Render relays only control and chat messages. Live camera feeds use a peer-to-peer WebRTC mesh; optionally Metered TURN carries camera media when direct connectivity fails. Each broadcaster may have to upload separate streams to up to seven other participants in a full eight-person room.
- **Existing abuse/operational risks:** No global room creation rate limit, no database persistence, no cross-instance socket adapter, and no aggregated live room/participant metrics. Search/ICE rate-limit maps are process-local. Anyone possessing a valid room link can enter until the room is full.

## What is free today?
| Component | Current confirmation | Limitation |
| --- | --- | --- |
| Render web service | **Confirmed on `free` compute** by the connected Render service | 512 MB RAM, less than 1 CPU, can spin down after 15 minutes inactive, 750 free instance hours per workspace per calendar month; not for production-scale traffic |
| Render workspace bandwidth | Hobby workspace includes **5 GB/month** outbound, then listed at **US$0.15/GB** | Workspace-level billing/usage cannot be fully verified from service plan alone |
| YouTube player | Official embedded YouTube player requires no video-hosting bandwidth on Render | Owners can block embedding, countries can differ, platform rules apply |
| YouTube Data API | Default search allowance is **100 searches/day**, subject to Google Cloud API quotas | This app additionally caps uncached searches to **70 per UTC day per process** and **12 per socket per hour**; actual Google Cloud billing/settings were not inspected |
| Metered TURN | Metered advertises **20 GB free TURN relay traffic per month** | Earlier/current Render logs showed **401 authentication failures**. Settings may exist but are not confirmed functional or free within the user's Metered account |
| GitHub source | Repo is connected and changes deploy from `main` | The user's GitHub account billing plan was not independently checked |
| `everydaygrove.ca` domain | Already purchased at Hostinger | Domain registration and renewal are not free, price depends on the user's purchase/renewal terms |

Render service metrics (partial sample for November 14) returned about **59–65 MB memory** on several instance samples and roughly **0.37–1.87 MB** outbound per sampled hour. CPU, latency and request-count metrics were empty in that query. **These sparse measurements cannot establish peak capacity or the number of active rooms.**

The current environment can remain low-cost for small private testing, but it is **not guaranteed permanently free**: bandwidth overage, domain renewal, TURN usage, Google Cloud charges (if billing/quota settings change), and optional future infrastructure may create costs.

### Recent TURN diagnosis
Logs on November 14 returned `TURN configuration unavailable: Metered credentials request failed: 401`, including after the latest release. `/health` currently reports only whether environment variable pairs exist—not whether the API key is accepted or a relay candidate works. Verify the correct Metered application domain and credential-scoped API key in Render, without posting secrets. Confirm by creating a test call from two different networks and inspecting ICE candidates and connection status.

## Can we support more traffic?
**Today: small prototype, not a proven scalable service.** There is no hard cap on total room creation, but free Render offers one small instance. Scaling to multiple app instances without changing the architecture would split rooms and signaling between independent memory maps. A single restarted instance also loses all room state. WebRTC camera distribution creates potentially high upload/relay traffic as room audience size grows.

**Measured capacity:** Unknown. No successful load test or reliable active-room counter exists. Do not promise 100, 500 or 1,000 rooms until the measurements exist.

### Recommended staged upgrade
1. **Before inviting the public:** enforce room creation/rate limits, basic abuse reporting and invite controls; add anonymous active-room, socket, and error-rate metrics; measure reconnects and camera connection success. Use staged tests at 10, 25, 50 and 100 concurrent rooms, varying active participants, and watch CPU, RAM, p95 signaling latency, connection loss and TURN bytes.
2. **Early production:** move the Render web app to a paid instance to avoid free instance sleep; store room state, chat and queue in a durable database (e.g., Postgres). Add room expiration, session recovery, basic admin moderation, backups and privacy/retention settings.
3. **Several server instances:** add Socket.IO cross-instance communication (Redis adapter plus sticky sessions when required) and shared/durable room state, then configure autoscaling. Alternatively use managed real-time services.
4. **More than two cameras or many spectators:** replace peer-to-peer camera mesh with an SFU (LiveKit/other managed video solution) rather than sending seven streams from a participant's phone.
5. **Search at scale:** move from per-process caches/rate limits to shared persistence and request control; request YouTube API quota increases after proving compliance.

A **starter Render web instance is listed at US$7/month**, small managed Postgres instances start at about **US$6/month**, and Redis-compatible paid Key Value starts at **US$10/month** on Render's currently published pricing; these are starting examples, not a quote or a complete production budget.

## Netflix and Prime Video
| Integration option | Technical/legal feasibility | Recommendation |
| --- | --- | --- |
| Embed Netflix/Prime movie directly in Togetherly iframe | **Not available through a general public consumer playback API**; controlled players use DRM and platform authorization. Content rights and service terms restrict copying, rebroadcasting, bypassing protections or public/commercial use. | Do **not** build |
| Display licensed catalog metadata and provider availability by country | Feasible via licensed/open catalog data, proper attribution, deep links, without streaming the media | **Good next feature**; show Canada and India availability separately |
| Open official Netflix/Prime app/site outside Togetherly and keep the watch room for chat/calls | Feasible as companion experience, but **does not automatically synchronize protected playback** | Good low-risk option; be explicit about limitations |
| Independent browser extension to coordinate playback on each viewer's own provider account | Technically possible, demonstrated by products like Teleparty, but compatibility, platform terms, permissions, security, and regional rights need legal/product review; browser extension cannot seamlessly cover every mobile app | Research/prototype only before claiming support |
| Screen-capture/rebroadcast one person's subscribed movie to all other guests | High risk of DRM/terms/copyright violations; cannot be treated as a supported streaming integration | Do **not** build |

**Prime Video:** Amazon's staff confirmed the original Prime Video Watch Party was discontinued on April 2, 2024. Prime Video's current terms grant personal, noncommercial, nontransferable viewing rights and restrict redistribution, broadcasting and DRM circumvention.

**Netflix:** Netflix publicly says its accounts are for personal, noncommercial use; its help centre and membership rules distinguish geographical content availability and account access. A Canada-to-India screening needs the title available in **both** regional catalogs and authorized access for each viewer. Netflix doesn't provide a general-purpose public third-party movie embedding player for this use case.

**Teleparty:** Its support pages describe a browser extension/app supporting Netflix and Prime Video, synchronized playback and chat, with each participant needing access to the streaming service and title; this is independent of Togetherly, and integrating our own extension requires separate evaluation.

**Product priority:** Keep Togetherly YouTube-first, consider legal movie/series availability discovery for Canada and India, and investigate an optional companion/extension experience only after the core watch room is stable. Don't promise full Netflix/Prime playback inside Togetherly.

## References
- https://render.com/docs/free
- https://render.com/pricing
- https://developers.google.com/youtube/data/getting-started
- https://www.metered.ca/tools/openrelay/
- https://www.amazonforum.com/s/question/0D56Q0000DlvfZvSQI/watch-party
- https://www.primevideo.com/help?nodeId=202095490
- https://help.netflix.com/en/node/633853347904100
- https://help.netflix.com/en/node/123279
- https://www.teleparty.org/support
