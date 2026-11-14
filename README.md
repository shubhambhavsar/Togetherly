# Togetherly

Minimal YouTube-first watch party with shareable rooms, synchronized playback, chat and one-to-one WebRTC video calling.

## Local setup
Install Node.js 20+, run `npm install` and `npm start`, then open `http://localhost:3000`. For cross-device calls deploy to HTTPS (localhost works locally).

## Render
Create a Render Web Service from this repository or use its `render.yaml` Blueprint. Build: `npm install`; Start: `npm start`; health check: `/health`. Free instance may sleep when idle. Rooms and chats are in-memory and disappear on restart; use sticky single-instance deployment until rooms are moved to persistent shared storage.

## Hostinger DNS
After Render service is working, add both `everydaygrove.ca` and `www.everydaygrove.ca` under Render custom domains. In Hostinger hPanel DNS zone remove conflicting old Shopify A/AAAA/CNAME website records only, then enter *the exact DNS values displayed by Render* and verify. Preserve MX, SPF, DKIM, and other email records.

## Calling
WebRTC uses a public STUN server by default. For more reliable connections across NATs, configure Render environment variables `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` for your own TURN service. Each user must approve camera/microphone permissions. Calls are not recorded by Togetherly.

## Notes
Embedded YouTube videos can be region blocked or embedding disabled. Mobile autoplay usually requires a tap. Keep YouTube's native player, attribution, and ads intact. The server does not relay YouTube media. For production, add room expiry, rate limiting, anti-abuse controls, privacy policy, persistent room state, more careful connection handling, and tests on iOS Safari/Android Chrome. Not independently end-to-end tested.

## Call reliability (TURN relay)
The video grid uses a peer-to-peer WebRTC mesh, currently supporting up to four participants. Direct STUN-only connections **do not work on every network**. If a tile says "TURN relay needed", create credentials with a TURN provider. Using more video peers increases bandwidth and CPU use.

**Metered Open Relay quick setup:**
1. Open https://www.metered.ca/tools/openrelay/ and create an account. Their published free quota is currently 20 GB/month; review latest terms and limits.
2. In Metered's dashboard, create a TURN credential. Under the credential, select **Get credential → Show API Key**. This is the *credential-scoped* API key, not the account-wide secret.
3. Find your Metered domain in the Developers area, e.g. `your-subdomain.metered.live`.
4. In Render → Togetherly → Environment, add:
   - `METERED_TURN_DOMAIN` = `your-subdomain.metered.live`
   - `METERED_TURN_API_KEY` = the credential-scoped key
5. Save the environment variables and let Render redeploy. Close and reopen all watch room tabs and rejoin the call.
6. Use Metered's TURN testing page to verify that you can obtain a relay candidate. A TURN provider is an external service and needs an account plus credentials; adding this integration alone doesn't create a working relay.

The server fetches ICE servers from Metered and gives that connection configuration only to clients who have joined a watch room. It never exposes the account-wide Metered secret. The server also accepts direct/static TURN settings `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL`. The static configuration takes priority.

**For larger public use:** use short-lived TURN credentials, tighter relay quota limits and an SFU rather than a four-way mesh.

## Cinema mode and call dock
Use **Fullscreen** on the Togetherly video player instead of the YouTube native fullscreen button. This keeps all camera tiles and the chat bubble in the same fullscreen element, with a theater-mode fallback on some phones. Select **Minimize** next to the floating call tiles to hide the videos without ending the call; use the camera bubble to restore them. Minimize does not disable your camera or mic — use the explicit camera/mic controls for that.
