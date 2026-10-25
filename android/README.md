# Narwhall Android beta

Android host for https://narwhall.app/. Package: `app.narwhall.beta`, version `0.1.0-beta` (1), Android 8.0+.

The installed app runs the live HTTPS site. Normal web changes appear on reopening/reloading; Android permissions and native changes require a new signed APK with the same app ID and key and a higher version code.

## Build

Open this directory in Android Studio with JDK 17, Android SDK 35 and Build Tools 35.0.0, or use Gradle 8.11.1 with `gradle :app:assembleDebug` for local development. A reproducible low-dependency packaging script is provided at `build_apk.py` for the Codex build environment. Its signing file is private and must never be committed. Run `python build_apk.py --help` for inputs.

Beta installation builds use a private signing key kept separately from source. This beta package is separate from a future Play Store application. Preserve the signing backup to update existing beta installations.

## Behaviour

- No address bar; purple system surfaces and native system-bar / keyboard insets.
- HTTPS app navigation restricted to narwhall.app. External HTTPS links open in the browser.
- Camera access only after an app camera action and Android permission; video only, no audio permission.
- Photo picker exposes only the image selected by the person, with no full-gallery permission.
- Supabase sessions persist in the WebView's local storage. Password reset links currently open in the normal browser; the new password also works in the beta.
- Back closes a capture draft or returns to Camera before exiting.
- Backgrounding stops camera preview and leaves a live Pong game.
- Main-page network and TLS errors show a Retry screen; TLS errors are never bypassed.
- No native JavaScript bridge, broad file access, cleartext traffic or third-party cookies.

## Phone acceptance checks before wider distribution

Install and open; sign in; close/reopen and confirm the session persists; grant/deny camera; flip camera; try filters and face tracking; choose a gallery photo; post to each intended audience; confirm wall styles, peeks and Inbox; play Pong from two different accounts on separate phones; background/return; test airplane mode and Retry; keyboard and Back; rotate screen; test the same-key higher-version beta update without uninstalling.

Build/signature checks do not replace these real-device checks. There is no push notification service or offline photo sync in this beta.
