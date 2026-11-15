# Togetherly — Blue Hour Cinema

A minimal shared YouTube watch room at https://everydaygrove.ca. One invitation link lets friends watch in sync, chat, and — with consent — view two live camera participants.

## Experience
- Create a room and invite friends (no accounts required).
- Up to **8 people per room**, with only **2 camera seats**.
- Other participants can watch the synced YouTube player and chat independently of video-call connectivity.
- Spectators automatically subscribe to room cameras without granting camera/microphone permissions. A passive viewer never publishes video or audio.
- Choosing **Join on camera** explicitly makes that participant's video and audio available to everyone with the private room link. The UI discloses this before joining. Camera seats remain limited to two.
- Minimize camera tiles to a compact bubble, or keep them on screen in Togetherly theater/fullscreen mode. Chat stays in the normal room and is not available in fullscreen.
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

## Camera calling and TURN
Togetherly uses peer-to-peer WebRTC with STUN, plus optional Metered TURN when valid credentials are configured. Watching a shared camera still requires a media connection for each spectator. Without working TURN, viewers on some mobile networks may not receive the camera feeds; the movie and chat continue independently. For reliable larger groups, a managed SFU would be a future integration.

Camera publishing is **off until a person deliberately clicks Join on camera**. Once enabled, the feed is room-visible, including for spectators. The app currently has no call recording feature.

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
- Call controls are contextual: everyone sees room cameras automatically without a Watch call button; clicking **Join on camera** deliberately publishes video and audio to everyone in the private room. On-camera participants get **Mute microphone**, **Turn camera off**, and **Leave camera** controls.
- Shared queue titles preserve ordinary characters (including `f` and `x`), decode common HTML character references, and show a thumbnail and two-line title.

## Verifying TURN setup without exposing credentials
Your Render environment must contain both `METERED_TURN_DOMAIN` (the actual `your-app.metered.live` hostname) and `METERED_TURN_API_KEY` (the credential-scoped key). Configuring just the key is **not sufficient**.

After deploying this release, the service's `/health` endpoint reports `relayConfigured: true` only when a complete static TURN pair or the two Metered settings are present. This reports configuration **presence**, not whether credentials are valid or whether relay candidates successfully connect. To validate actual relaying, join a watch room and test a call across two different networks while checking `/api/rtc` and WebRTC ICE candidates. Never share the key in chat, commit it to GitHub or expose the provider's account-wide secret.

## Proposed UI improvement — cinema dock and tap-to-size cameras
- In the normal watch room, **Chat** is alongside **Theater** and **Explore videos** below the player, instead of floating on top of the film.
- In fullscreen/theater mode, only **Exit fullscreen** stays visible; Chat remains in the normal watch room. On phones Exit is a compact right-edge control. The chat uses a standard speech-bubble icon (not a telephone glyph).
- The fullscreen Exit control stays inside the player; the normal chat panel stays outside fullscreen and never covers the movie.
- Video previews no longer show separate Minimize and Expand buttons. Tap the camera tile surface to cycle: **compact preview → minimized camera bubble → enlarged preview → compact preview**. A tap on the minimized bubble continues the cycle. A keyboard user can press Enter or Space on the tile surface.
- Resizing camera tiles only changes their display. It does **not** mute, stop, or restart microphone/camera streams or interrupt the existing call.
- These changes are intentionally prepared on a feature branch and require a separate approved merge to production.

## Pending mobile fullscreen compact-controls refinement
On phones, fullscreen contains only a compact **Exit fullscreen** button on the right edge; there is no fullscreen chat window or chat button. To send messages, users exit fullscreen and open Chat below the video. Desktop fullscreen likewise has no chat window. This is a stylesheet and markup refinement only; it does not change signaling, video, TURN, or chat delivery logic. Merge only after the user approves deployment.

## Pending: automatic spectator cameras and keyboard-safe mobile chat
- Everyone who opens a room subscribes *receive-only* to active camera seats automatically, without a separate Watch call action and without invoking camera/microphone permissions.
- A person actively choosing **Join on camera** is told that their video/audio is available to other participants with the room link. Camera publishing is never automatic, even after refresh or reconnect.
- Spectator camera video defaults to muted autoplay on mobile to avoid blocking display; tapping a tile can enable audio where the browser permits it. Camera display is best-effort when WebRTC cannot connect.
- Chat in fullscreen uses the browser's `visualViewport` height and top offset while the message field is focused. The message list scrolls inside a sized panel, and the composer stays above the software keyboard whenever the browser reports the visible viewport correctly.
- Opening chat on mobile does not automatically focus the text field and summon the keyboard. The user explicitly taps the input to type.
- Review branch only until the user explicitly approves with `deploy` (Render publishes `main` automatically).

## Pending release: keep chat outside fullscreen and simplify unavailable-video messages
- In fullscreen, camera tiles and Exit fullscreen remain visible; chat is deliberately unavailable there. Exit fullscreen to access the normal chat button and drawer.
- Successful Watch Shelf searches do not show a technical embedding/region precheck notice. Eligibility filtering still runs in the backend.
- If YouTube playback fails, users see **This video is not available. Choose something else.** plus a **Find another video** action. YouTube error codes remain in console diagnostics, not the user-facing message.
- See `docs/streaming-capacity-review-2026-11.md` for research into Netflix/Prime Video integration, current costs, room limits, and suggested scaling architecture.

## Experimental shared website player (live)

Alongside the existing YouTube URL input, room members can enter a **public HTTPS website URL** into the new **Website Player (Beta)** field and choose **Show website**. Togetherly broadcasts the validated URL to the room; each participant's browser attempts to display the same external website inside an iframe. A visible source badge and **Open in browser** fallback are always available.

**This is NOT synchronized third-party movie playback.** It shares the initial page address only; navigation, play/pause, seeking, video availability, authentication and cookies are controlled by the external site and browser. Some sites prevent being framed through `X-Frame-Options` or `Content-Security-Policy: frame-ancestors`, and we deliberately do not try to bypass these restrictions. User-supplied sites such as Apne TV or Flex Movie have **not** been verified to work or authorized for screening on Togetherly. Selecting a site does not supply licensing rights. Netflix and Prime Video cannot be shared by signing one subscriber in through this feature.

Security measures: public HTTPS URLs only, block IP/private hosts/internal domains, block URL credentials and obvious secret-bearing query params, prohibit embedding Togetherly's own origin, never fetch or proxy third-party media on the server, and load the website inside a restricted iframe by default (`allow-scripts allow-presentation` only; no iframe form submissions, popups, same-origin permissions, or top navigation). If an external website rejects being sandboxed, **each viewer can separately select Try compatibility mode** and confirm the hostname and warning. This removes Togetherly's iframe sandbox for that *one URL and that viewer's current browser session*; it does not automatically apply to other room members, preserve approval across reloads, or bypass the destination website's own anti-framing headers. The iframe is unloaded and reloaded whenever the sandbox setting changes, as required by browser behavior. The **Restore protection** button reverses the opt-in, and switching URLs or returning to YouTube restores the protected default. While unsandboxed, an external site may trigger popups, forms, sign-in prompts or navigation attempts; **only use sources you trust and are authorized to access, and don't type passwords inside Togetherly's embedded frame**. If playback is still blocked, use **Open in browser**.

Switch back to YouTube through the existing YouTube link and **Play now** controls or queue. The normal chat, camera tiles, and fullscreen exit remain unchanged. New room state fields `source` and `websiteUrl` live in process memory and will be lost on Render restart as before.

### Optional third-party website suggestion

The **Website Player (Beta)** includes a **Use FlexFlix link** button. It fills `https://flexflix.site/` into the URL field but does **not** load an iframe, broadcast the URL, or open another tab. A participant still has to select **Show website** explicitly. Label the suggestion clearly as an **unverified, unaffiliated third-party website** with potential advertising and popups. This is a user-requested shortcut, not a licensing, safety, or availability endorsement, and it does not change the playback/redirect guarantees.

### Website safety additions (live)

The current live site already offers compatibility mode and Restore protection. The deployed release adds the following protections to the shared Website Player, without changing the server-side room URL or affecting other participants:

- **Stop website:** Immediately unload the embedded page on the viewer's current device, restore sandbox defaults, and keep the room/chat/camera connected. Subsequent room sync events **do not reopen** the stopped page. **Reopen protected** reloads the same URL using the default sandbox. Sharing another website or returning to YouTube clears the stopped state.
- **Best-effort navigation warning:** When a viewer enters unrestricted compatibility mode, Togetherly registers a `beforeunload` listener to request a browser-native confirmation before the parent Togetherly tab navigates away. The listener is removed on Restore protection, Stop website, new shared URL, or YouTube. Togetherly's own Leave button disarms the warning first. **Browsers may ignore these confirmations** depending on browser, device, and prior interaction; they do not block popups or redirects reliably.
- **Permissions-Policy hardening:** Keep camera and microphone permission restricted to the Togetherly origin, keep clipboard write available to Togetherly (for invite-link copying), and disallow unnecessary geolocation, payment, screen capture, clipboard reading, device/sensor APIs on the host page and descendant frames.
- **Safe external fallback:** **Open in browser** retains `rel="noopener noreferrer nofollow"` and `referrerpolicy="no-referrer"` to avoid exposing the Togetherly page as an opener or passing room URLs as referrers.

**Limitations:** An unsandboxed third-party frame still controls its own content and may open new tabs/popups or navigate using browser-permitted gestures. The parent page cannot reliably inspect cross-origin ads, block all popups, or intercept iframe-internal redirect chains. Use a browser-level popup blocker or reputable content blocker for stronger filtering. Do not attempt to evade the embedded website's own framing, access, DRM, or content rights restrictions.

### Pending: FlexFlix default compatibility and website fullscreen (review-only)

- When a room shares an HTTPS URL with **exactly** `flexflix.site` or `www.flexflix.site` as the hostname, the new Website Player uses **unsandboxed compatibility mode by default**, without the extra confirmation click. Other domains, including similarly named sites and subdomains, remain sandboxed. The external site remains unverified and unaffiliated with Togetherly. All viewers of that shared URL will load it with fewer iframe restrictions unless they select **Restore protection** or **Stop website** on their own device. The browser navigation warning is enabled for default compatibility too; **it is not an ad or popup blocker**.
- Users who choose **Restore protection** or **Stop website** are not silently returned to unprotected mode for the same shared URL; **Reopen protected** always reopens with the sandbox. Switching to another room URL resets local state.
- A **Fullscreen + cameras** control uses Togetherly's existing full-stage fullscreen/theater implementation, so the website remains on screen with Togetherly's camera tiles and Exit fullscreen button. The user can also try the source's native fullscreen via the iframe's `allow="autoplay; fullscreen *"` and `allowfullscreen` settings, but native fullscreen controlled by the third-party player may hide Togetherly's camera overlay and depends on the browser and the site's own nested iframe permissions. Neither fullscreen mode gives Togetherly synchronized third-party playback.
- This is an **experimental change, not proof of streaming rights or safe content**. It does not block ads, bypass third-party DRM or iframe policies, or control fullscreen inside an unaffiliated site's player.

**Do not merge or deploy these pending changes until the user explicitly requests `deploy`.**
