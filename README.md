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

### Website safety additions (review-only)

The current live site already offers compatibility mode and Restore protection. This change adds the following protections to the shared Website Player, without changing the server-side room URL or affecting other participants:

- **Stop website:** Immediately unload the embedded page on the viewer's current device, restore sandbox defaults, and keep the room/chat/camera connected. Subsequent room sync events **do not reopen** the stopped page. **Reopen protected** reloads the same URL using the default sandbox. Sharing another website or returning to YouTube clears the stopped state.
- **Best-effort navigation warning:** When a viewer expressly enables unrestricted compatibility mode, Togetherly registers a `beforeunload` listener to request a browser-native confirmation before the parent Togetherly tab navigates away. The listener is removed on Restore protection, Stop website, new shared URL, or YouTube. Togetherly's own Leave button disarms the warning first. **Browsers may ignore these confirmations** depending on browser, device, and prior interaction; they do not block popups or redirects reliably.
- **Permissions-Policy hardening:** Keep camera and microphone permission restricted to the Togetherly origin, keep clipboard write available to Togetherly (for invite-link copying), and disallow unnecessary geolocation, payment, screen capture, clipboard reading, device/sensor APIs on the host page and descendant frames.
- **Safe external fallback:** **Open in browser** retains `rel="noopener noreferrer nofollow"` and `referrerpolicy="no-referrer"` to avoid exposing the Togetherly page as an opener or passing room URLs as referrers.

**Limitations:** An unsandboxed third-party frame still controls its own content and may open new tabs/popups or navigate using browser-permitted gestures. The parent page cannot reliably inspect cross-origin ads, block all popups, or intercept iframe-internal redirect chains. Use a browser-level popup blocker or reputable content blocker for stronger filtering. Do not attempt to evade the embedded website's own framing, access, DRM, or content rights restrictions.

This change is **only on a review branch**. Do not merge or deploy until the user explicitly requests `deploy`.

## Proposed feature: experimental FlexFlix drift correction (review-only)

**This feature is on a separate review branch and has not been deployed.** It is independent of the pending FlexFlix default-compatibility/fullscreen PR #11.

The website player will show **Enable auto sync** for a room sharing a FlexFlix HTTPS URL. Automatic sync is **off until each participant explicitly enables it**. It requires the optional, locally installed [Togetherly Movie Sync Companion](companion-extension/README.md) in each supported desktop Chromium browser.

- The first room creator is the source-of-truth timing leader; if the leader leaves, the next connected participant can publish timing.
- The leader's companion sends only `currentTime` and `playing` from a directly accessible HTML5 video to the existing Socket.IO room. Guests' companions compare their own position to that timeline.
- A drift of **at least 2.5 seconds** triggers a seek within the available seekable range. A drift of **0.65–2.5 seconds** temporarily adjusts playback rate to 0.93× or 1.07×. When aligned, playback speed returns to 1×.
- Playback is restricted to the exact FlexFlix hostname and its `www` variant for this prototype. A guest may need to click Play once before browsers allow autoplay. All guests must select the same movie and cut individually.
- Video data, signed media links, cookies, and DRM credentials are neither extracted nor shared. The extension does not provide access to otherwise unavailable content.
- **No automatic control is possible for unknown nested third-party player origins.** FlexFlix publicly states that its videos are provided by unaffiliated services; therefore many actual movies may remain **unsupported**. When the companion cannot detect an accessible `<video>`, Togetherly will show that status instead of falsely claiming the movie is synchronized.
- The implementation has source-level and simulated integration checks; **no live-browser test of FlexFlix playback compatibility has been completed**.

**Do not merge or deploy this feature until the user explicitly says `deploy`.**



## Discover-first rooms, mixed watchlist and distraction-free controls

- **On a genuinely empty room:** The server sends `selectedMedia: false` (rather
  than treating its fallback YouTube ID as a selection). Phone users go straight
  to the in-room Discover sheet; desktop users see the full discovery panel
  before the inactive player. Watch remains reachable. Selecting any supported
  YouTube video, movie or TV episode flips `selectedMedia` to true. Future
  guests then enter the Watch screen, even when playback is paused.
- **One shared Up Next:** The same room queue now accepts YouTube video IDs
  and approved movie/episode catalogue entries. Each item is validated by the
  server; movie URLs are reconstructed from allowlisted identifiers when played,
  never taken from client-supplied iframe links. Episodes store season and
  episode. The queue is available from both Discover and Watch.
- **Cinematic player controls:** The overlaid Play/Pause, ±10-second and
  Togetherly Theater buttons hide after 3.2 seconds of activity-free playback.
  A click/tap on the protected movie surface reveals them; another tap hides
  them. Pausing pins controls in view. On hover-capable devices moving the
  mouse reveals them; keyboard focus does too. The iframe never receives taps,
  even while the controls are invisible. The separate fullscreen control is
  hidden in movie mode, but YouTube retains its usual controls.
- **Existing limitations:** VidFast playback may ignore messages or rebuffer on
  reload; the movie room clock is approximate. The externally hosted iframe
  remains unsandboxed for compatibility and may still create script-initiated
  tabs or display ads without any direct clicks. Camera permissions, the 2-seat
  limit and chat stay unchanged.

## Dual themes and automatic video-call recovery (review branch)

Togetherly supports two visual experiences via a header switcher: **Private
Cinema** (original dark) and **Living Room** (warm light with coral, plum,
lavender). This preference is stored per browser in
`localStorage['togetherly.appearance']`; it does not modify the room or
other participants' visual settings. It persists across room links and reloads.
The switch is keyboard-accessible, keeps the browser toolbar color in sync,
and changes appearance without reinitializing the player, chat, or camera.

**Call reliability:** Temporary WebRTC ICE disconnects are expected on mobile
network switches, slow Wi-Fi, or tab/background changes. Togetherly now waits
briefly for spontaneous recovery, then attempts bounded ICE renegotiations
before replacing a stalled peer connection once. Successful connections and
departing peers clear recovery timers. Returning from the background checks
for interrupted peers. An explicit camera/microphone opt-in is always required
after a **Socket.IO room reconnection**—Togetherly never silently restarts
publishing; receive-only spectator viewing can resume automatically.

A TURN relay remains essential for some mobile carriers, company networks,
and restrictive NAT combinations. Configure the existing
`METERED_TURN_DOMAIN` + `METERED_TURN_API_KEY` or the
`TURN_URL` + `TURN_USERNAME` + `TURN_CREDENTIAL` trio in Render, **not**
in this repository or a public message. The `/health` endpoint can report
whether relay settings are configured, but cannot prove that the relay is
working end-to-end. Real multi-network tests on iOS Safari and Android Chrome
are still required; no browser-level retry policy guarantees 100% uptime.

## Movie room clock + quieter fullscreen (2026-11-20)

Room movie sharing now carries a versioned **estimated timeline** alongside the
selected VidFast URL. New room members get a server-computed room position,
and the embed is opened with VidFast's documented `startAt` parameter
(`autoPlay=true` when the room clock is running). The iframe is **not** reloaded
on routine Socket.IO state updates, so chat/cameras and ordinary playback keep
working. The button **Join at room time** offers an explicit refresh for viewers
who join late or drift away.

When the host shares a movie, the approximate clock begins immediately.
The host can anchor it with **I'm playing now**, pause the room clock,
or enter a position such as `12:34` using **Set room time**. Only the current
room host can modify the shared clock; the server checks version, membership,
position bounds, and rate limits, and transfers host controls when the owner
leaves. YouTube remains on its existing independent automatic sync path.

Optional advanced behavior: if the exact, allowlisted VidFast frame actually
emits a valid `PLAYER_EVENT` via `postMessage`, the host may submit verified
progress samples, and guests with observable playback may try infrequent
`seek`/play/pause commands. The browser validates **both the sender origin and
the active iframe window**, checks the video identity if reported, and bounds
positions before acting. **These events and commands are not guaranteed by
VidFast's official public embed documentation** and may be unavailable.
A player that supplies no events stays on the estimated room clock and
one-click manual catch-up.

Limitations: `startAt` may be ignored by a particular provider backend or
overridden by saved playback progress, autoplay policies, ads, loading, or
buffering. Playback cannot be guaranteed synchronized exactly across browsers.
Movie content remains on a third-party unverified source. Never override
antivirus or phishing warnings; no video proxying, download, or circumvention
of playback restrictions is implemented.

Fullscreen Exit has moved to a compact 44x44 touch-target icon in the **upper
left** of the theater, away from camera tiles. The centered bottom dock is
overridden by the last stylesheet. Keyboard focus, Escape and browser-native
fullscreen exits remain available.

## Phishing warning mitigation / slimmer controls (review only)

The movie page no longer shows a wide Stop Player band on top of the embedded
video. A compact **Close movie / Resume movie** control lives in the regular
player toolbar, leaving the video unobstructed.

Two formerly offered embed hosts, `vsembed.su` (VidSrc adapter) and
`player.vidlove.cc` (VidLove adapter), have unfavorable independent phishing
reputation reports. They are **removed** from both the movie UI and the
server's allowlist. The removed Website Player form was already hidden; its
obsolete `website` Socket.IO event is now reject-only so an older client
cannot make the room open an arbitrary website.

The remaining VidFast embed is **not independently verified as safe**;
third-party scripts, nested frames, popups and redirects may still be blocked
by antivirus software. Togetherly will not bypass a browser or antivirus
phishing warning. The app cannot intercept and vet every cross-origin network
request from the nested iframe. When any URL is flagged, stop playback and use
a trusted, appropriately licensed viewing option. Do not whitelist a flagged
host or turn off protection just to watch a film.

## Cinema room refresh (review branch; not deployed)

The room now has a **Movies & Series / YouTube** switcher under the shared player.
The old arbitrary Website Player input, FlexFlix recommendation and experimental
movie-sync panel are removed from the interface. Browsers still support room chat,
camera seats and fully synced **YouTube** playback. Movie-source playback remains
**independent per viewer**, not cross-browser synchronized.

When a viewer selects a title in Movies & Series, the server constructs an
exact-match allowlisted VidFast URL. **Those verified catalogue embeds load
without the iframe sandbox** to restore compatibility with player scripts,
storage and embedded playback. Any non-verified future source must remain
sandboxed. Source URL verification and `frame-src` CSP remain in place.

**Togetherly-owned playback controls (experimental, local to each device):**
the cross-origin movie iframe has a **permanent click shield**. Every direct
pointer tap on the movie is intercepted on Togetherly's own page; no
`Use controls` unlock is provided. The overlaid control bar offers
**Play, Pause, -10 seconds, +10 seconds**. Togetherly Theater still shows
the room's camera tiles.

If the third-party player emits recognized `PLAYER_EVENT` messages, Togetherly
can request playback via verified-origin `postMessage`, and read back reported
position/state. **Do not mistake a sent command for playback confirmation.**
For a provider that does not respond, Play/Seek **reload** its embed URL with
documented `startAt` and `autoPlay` parameters. Pause always **unloads** the
iframe so audio/video stop even if native pause commands are unsupported.
The paused position is player-reported if available, otherwise *estimated*
from the local clock and may drift during buffering/ads. Reopening the player
may trigger buffering, startup ads, saved-progress overrides or a blocked
autoplay. A fully reliable, seamless Play/Pause/Seek experience cannot be
guaranteed without an official player API or a stream served with permission
through Togetherly's own video element. Room clock controls remain approximate.

**Security tradeoff:** the iframe is still unsandboxed for compatibility.
Even with a permanent click shield, the provider can show in-frame ads or
initiate popups/navigation **without a user click** if browser restrictions
permit it. The parent webpage cannot intercept arbitrary cross-origin
window-opening code; the browser's `beforeunload` prompt is best-effort.
Do not bypass antivirus warnings, open suspicious tabs or enter passwords
into external players. Stop movie unloads the provider without disconnecting
the room's chat or camera sessions.

The embedded provider's *native fullscreen* remains disabled via iframe
allow-list and `Permissions-Policy: fullscreen=(self)`; use **Togetherly
Theater** to keep Togetherly's camera tiles visible over the movie. This
retains the room watch experience without authorizing cross-origin fullscreen.

Movie playback remains independent per device, and room clock sync is
approximate. Player compatibility is unverified across all real Android/iOS
browser and provider conditions. The server neither retrieves nor redistributes
movies, and no third-party streaming source is guaranteed or endorsed.

## Movie & Series source picker (deployed baseline)

The **Movies & Series** section follows the general source-adapter pattern in [Streambert](https://github.com/truelockmc/streambert/blob/main/src/utils/api.js), independently implemented without copying GPL program code. It generates experimental third-party player addresses from an internal movie identifier and shares them with room members. It does **not** retrieve copyrighted streams, inspect player internals, synchronize external providers, or grant playback rights.

### Pending improvement: title-first instant suggestions

This review branch removes technical TMDB ID entry from the normal interface:

1. Open Togetherly's Movies & Series section.
2. Type a movie or series **name**; suggestions appear automatically after a 390 ms pause. Example title chips are also available.
3. Click a result card (poster when available, otherwise a movie/TV icon). The server resolves the ID invisibly.
4. For TV shows, choose season and episode; select a third-party playback source.
5. Select **Watch with room**; Togetherly shares the selected player website with room guests.

The GET /api/catalog/search endpoint returns public title results and the source used. It validates query length, rate-limits IPs, and caches results for ten minutes.

- With a server-side TMDB_API_READ_TOKEN or TMDB_API_KEY, Togetherly uses TMDB metadata and posters where available. Save credentials only in Render, never in GitHub or public client files.
- Without TMDB credentials, Togetherly searches Wikidata public records and retrieves TMDB movie or series identifiers from properties P4947/P4983. Users still do **not** need to enter IDs. Wikidata coverage is incomplete and poster images usually aren't available; the UI labels limited Wikidata results. If configured TMDB lookup fails, the server tries Wikidata.
- If both metadata sources are unavailable, Togetherly shows a clear search error rather than asking for a technical ID.

Review [TMDB terms](https://developer.themoviedb.org/docs/faq), metadata licensing, and image attribution before commercial use. The UI credits TMDB and Wikidata. A movie's presence in either catalogue does **not** grant rights to screen or redistribute the film.

### Experimental player limitations

The remaining VidFast player is unverified; the earlier VidSrc and VidLove providers were removed after phishing reputation warnings. Browser embedding restrictions, ads, regional restrictions, terms of service, autoplay, and copyright permissions still apply. The app does not proxy or download media, intercept playlists, or bypass DRM or frame protections. Cross-origin movies remain **unsynchronized**. The optional FlexFlix-only companion does not apply to these providers.

**Review only:** Test title lookup against real TMDB/Wikidata responses, mobile UI, provider embed behavior, and provider rights before production. Do not merge or deploy without an explicit user request to deploy.
