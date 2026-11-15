# Togetherly Movie Sync Companion (experimental)

This is an **optional Chrome/Edge Manifest V3 extension** for people who want automatic watch-party timing in Togetherly when the movie runs in a **directly accessible HTML5 video element** on `flexflix.site` or `www.flexflix.site`. It is not an official FlexFlix integration, and no video provider has approved or verified this integration.

## Installation (each participant, desktop Chrome or Edge)

1. Obtain a copy of this repository and extract it locally. Keep `companion-extension/` as its own folder.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode**, click **Load unpacked**, and select the `companion-extension` directory. Review the permissions before granting them.
4. Refresh `https://everydaygrove.ca`, create or join a Togetherly room, and share the FlexFlix page with **Show website**.
5. When the player is visible, choose **Enable auto sync** under the Website Player panel. Everyone who wants automatic sync must install and enable the companion separately.
6. The room creator (or next available room member if the creator leaves) is the timing leader. Guests should choose the **same movie and corresponding video/server** themselves. Press Play at least once if the browser blocks automatic playback.

The status will say **Host timing active** or **Guest drift correction active** only after the companion reports an accessible video. Otherwise it will say no compatible player is detected.

## Algorithm

- Every 2.5 seconds, the companion samples `currentTime` and `paused` from an accessible HTML5 `<video>` element (minimum 120-second duration, to avoid most short advertisements).
- Togetherly accepts samples **only from the room timing leader** and broadcasts a timeline tagged with the current room source version.
- Guests compare their own movie position to the room position.
- If the difference is **2.5 seconds or more**, the companion seeks to the shared position (within available seekable ranges).
- If it is **0.65–2.5 seconds**, the guest's local playback rate changes temporarily to **0.93× or 1.07×**. It returns to **1×** when the difference is small.
- Play/pause follows the room leader when the browser permits it; automatic Play can be blocked until the viewer interacts with the media.
- The server stores only playback timestamps, state, and the normal shared website URL. It does not proxy or retransmit media data.

## Limits and safety

**This extension does not automatically control third-party players hosted in nested cross-origin frames outside FlexFlix's two exact domains.** FlexFlix states that its videos are provided by unaffiliated third-party services. Many movies will therefore show **no accessible HTML5 player**; there is no reliable correction for those players without a supported provider API or separately authorized extension permissions. No claim of live FlexFlix movie compatibility is made.

The extension requests no browsing-history, cookies, webRequest, DRM, ad-block, network proxy, or arbitrary-host permissions. It is restricted to `https://everydaygrove.ca/*`, `https://flexflix.site/*`, and `https://www.flexflix.site/*`, and it reads only media time/playing/duration—not stream URLs or files. It does not help a guest access a film they cannot independently watch.

This is **not a Chrome Web Store release** and is not validated on mobile, Safari, or Firefox. Test with content you have permission to play. Do not enter passwords into untrusted embedded pages.

## Troubleshooting

- **Companion not detected:** Confirm it is installed and enabled, then refresh Togetherly.
- **Looking for HTML5 video:** The movie likely plays in an unrelated iframe/provider, or its video is not accessible through the extension. Switch to a supported provider, a local synchronized source, or manually coordinate playback.
- **Guest can't start playback:** Click Play in the movie once; modern browsers can block programmatic autoplay.
- **Guest jumps to the wrong point:** Verify everyone selected the same movie, episode, player source, and cuts/versions.
- **Firefox or mobile:** This version targets desktop Chromium browsers only.

The extension's matching rules and the timing algorithm are covered by repository smoke tests. They do **not** establish real-device compatibility with FlexFlix's third-party players.
