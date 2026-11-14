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
