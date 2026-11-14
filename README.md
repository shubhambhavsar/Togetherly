# Togetherly — Blue Hour Cinema

A minimal shared YouTube watch room at https://everydaygrove.ca. One invitation link lets friends watch in sync, chat, and — with consent — view two live camera participants.

## Experience
- Create a room and invite friends (no accounts required).
- Up to **8 people per room**, with only **2 camera seats**.
- Other participants can watch the synced YouTube player and chat independently of video-call connectivity.
- Spectators can opt into receiving the call without granting camera/microphone permissions.
- Each camera participant must explicitly select **Allow guests to see/hear my camera** before spectators may receive their video/audio. The other camera participant stays private unless they also opt in.
- Minimize camera tiles to a compact bubble, or keep them on screen in Togetherly theater/fullscreen mode.
- In-room watch queue, recently watched videos on this device, one-tap clipboard paste, and optional embedded YouTube search.
- Design palette: Midnight Navy #0B1420, Deep Slate #172433, Misty Blue #A8C7D8, Warm Ivory #F4F1EB, Soft Amber #E9BB89.

## Running locally
Install Node 20+ then:
```sh
npm install
npm test
npm start
```
Open http://localhost:3000. The app needs an HTTPS URL to access the camera/microphone on remote devices.

## Production / Render
Render is set to automatically deploy the `main` branch. A web service runs `npm start`, which first runs `npm test`. No database is required for this MVP; room video choices, queue and messages are held in process memory and reset when the service restarts, although a valid room link can reopen the room.

## YouTube discovery (optional)
To enable in-app searches, create your own Google Cloud API key with the **YouTube Data API v3** enabled and set `YOUTUBE_API_KEY` in the Render service's Environment settings. **Do not place the key in GitHub or browser code.**

Searches use the official API with embeddable-video filtering, a per-user limit and a conservative daily request budget. They still consume your Google Cloud API quota (typically 100 units per search); the app does not download, remove ads from, or rebroadcast YouTube streams. Some titles cannot be embedded or are region restricted.

Without the key, users can browse their recently watched videos, play the shared queue, open YouTube to discover something, copy its link and use **Paste** on Togetherly. Full search is **not available** until an API key is configured.

## Calls without TURN
Two-person calls already work on the tested networks; the app remains peer-to-peer (STUN) and does **not** require TURN credentials. Watching someone else's video call is still a real WebRTC connection; spectators on certain mobile networks may not be able to receive the camera feeds. If that happens, they can continue the shared movie and chat. For reliable spectator media and larger groups, a managed SFU (e.g. LiveKit) would be a future integration.

A camera's consent to spectators is **off by default**. A public invitation link only grants entry to that room. It does not enable camera feeds or recording. The app currently has no call recording feature.

## Limitations / next steps
- Fullscreen uses Togetherly theater mode, not YouTube's native fullscreen, to preserve overlays. Safari may use a screen-filling fallback.
- In-memory rooms and chat are not persistent. Free Render services may sleep/restart.
- Improve cross-device call testing, video-sync accuracy, reconnection resilience, room abuse protection, playback error feedback and mobile browser compatibility before relying on this commercially.
- Licensed movies, Vimeo, and protected services (Netflix, Prime, Disney+) aren't embedded in this release; research those separately with permissions and regional rights.

Source: https://github.com/shubhambhavsar/Togetherly

## Pending release: player layout, chat acknowledgments, movie eligibility
- Theater control now lives in the player toolbar and remains available to exit fullscreen; floating call tiles are positioned lower to avoid video-title overlaps.
- The desktop room rail has a compact, scrollable message history and always-visible composer; mobile/fullscreen chat remains a bottom sheet.
- Chat uses `chat:send` and `chat:new` Socket.IO events with delivery acknowledgments. Failed messages stay in the draft field and show an error; legacy clients still receive the old message event during deployment.
- YouTube discovery additionally checks `videos.list` for `status.embeddable` and public/region access in **Canada and India**. Even an eligible video can still be blocked by platform policy or rights claims. Error 101/150 shows **Find another video** and avoids repeating the same blocked title in the current browser session.
- YouTube media streams are always served by YouTube directly; Togetherly cannot override an owner's embedding restrictions.

## Metered TURN configuration (optional)
If you created a credential through https://www.metered.ca/ , keep the actual credential-scoped key **out of GitHub and chat**. In Render → Togetherly → Environment, set:
```text
METERED_TURN_DOMAIN=your-app.metered.live
METERED_TURN_API_KEY=your-credential-scoped-api-key
```
Replace `your-app` and the sample key with values from your own Metered dashboard. Do not use the account-wide Secret Key. The server has an existing `/api/rtc` endpoint that fetches the ICE server array on behalf of room participants; **no additional browser snippet is needed**. Render will redeploy after an environment-variable change. The presence of a variable does not prove real-world relay success: test an actual call on different networks and verify relay candidates with Metered's TURN test page. Free quotas may apply.

## Release safety
Changes in feature branches are not published until merged into `main`. Because Render deploys `main` automatically, merging constitutes deployment.

## Simplified controls and returning to rooms (proposed release)
- Use the native YouTube player to play, pause, and seek. The separate duplicate play/pause/resync buttons are removed; the in-room playback state continues to synchronize automatically on YouTube player events and through periodic sync messages.
- Your saved display name allows automatic room re-entry after refreshing a valid invite link. If the browser has no saved name, it still asks you to enter one. For privacy, camera/mic is **never** restarted automatically after a refresh.
- Call controls are contextual: before joining, you see **Join on camera** (or **Watch the call** when a camera call exists); after joining on camera, you see **Mute microphone**, **Turn camera off**, and **Hang up**. Spectator sharing remains opt-in and is offered only when spectators are in the call.
- Shared queue titles preserve ordinary characters (including `f` and `x`), decode common HTML character references, and show a thumbnail and two-line title.

## Verifying TURN setup without exposing credentials
Your Render environment must contain both `METERED_TURN_DOMAIN` (the actual `your-app.metered.live` hostname) and `METERED_TURN_API_KEY` (the credential-scoped key). Configuring just the key is **not sufficient**.

After deploying this release, the service's `/health` endpoint reports `relayConfigured: true` only when a complete static TURN pair or the two Metered settings are present. This reports configuration **presence**, not whether credentials are valid or whether relay candidates successfully connect. To validate actual relaying, join a watch room and test a call across two different networks while checking `/api/rtc` and WebRTC ICE candidates. Never share the key in chat, commit it to GitHub or expose the provider's account-wide secret.
