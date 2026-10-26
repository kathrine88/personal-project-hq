# Stage 3C-A — iPhone Home Screen app

## Release and installation

No Supabase changes, SQL, secrets, server jobs or new hosting setup are required.
Merge the PR only after review, then wait for the normal GitHub Pages deployment
to succeed. An unmerged PR is not a live preview.

On your iPhone:

1. Open **Safari** and visit https://kathrine88.github.io/personal-project-hq/.
2. Tap **Share** (the square with the upward arrow).
3. Choose **Add to Home Screen** (scroll through the actions if needed).
4. Leave **Open as Web App** enabled if Safari shows that option, then tap **Add**.
5. Open the green sprout icon from your Home Screen. Sign in if prompted.

Safari and installed apps can have separate session storage depending on iOS.
Having to sign in once in the installed app is expected. No notification prompt
should appear. Stage 3B reminders remain in-app reminders: this release does not
deliver notifications while the app is closed.

## Update and privacy strategy

The root `sw.js` has no fetch handler and never uses Cache Storage. It does not
cache HTML, JavaScript, Supabase responses, private uploads or signed file URLs.
There is no offline mode; an Internet connection is required. Existing Supabase
session persistence is unchanged; this does not remove normal browser HTTP caches.

The registration uses the stable worker URL under `/personal-project-hq/` and
`updateViaCache: 'none'`. It checks for worker updates on load and when the app
returns to the foreground. Lifecycle-only workers activate immediately and claim
clients, safely because they do not intercept any requests. There is no automatic
page reload, so unsaved edits are not discarded. Application code updates load on
the next normal navigation/relaunch/reload, subject to GitHub Pages/CDN and normal
HTTP cache revalidation. An already-open page keeps its loaded code until then.
Do not promise immediate rollout to every open app.

Keep the worker URL stable across deployments. No version bump or precache list
is needed. If request caching is ever introduced, revisit immediate activation
and add a user-controlled update flow first. Stage 3C-B can extend this same
registration with push handling; this stage adds no permissions, subscriptions,
delivery service or scheduled jobs. The worker's scope excludes other GitHub
Pages projects on the same origin. Never unregister unrelated workers or clear
origin-wide storage to update this app.

The editable icon master is `images/app-icon.svg`; the committed opaque PNGs are
192×192, 512×512 and 180×180 (Apple touch icon). Render replacements from the same
master when changing the design; no image/build dependency is needed at runtime.

## iPhone Safari checklist (after deployment)

Maintainers can run `node --test tests/*.test.mjs` and, with the existing
Playwright setup, `node tests/pwa-browser.cjs` plus the existing browser suites.
The PWA check uses a real localhost server to verify subpath registration, icons,
scope isolation, network-only requests and worker replacement without losing a draft.

- [ ] Safari loads the existing site at `/personal-project-hq/`; all six project cards and sign-in work.
- [ ] Share → Add to Home Screen shows the sprout icon and Project HQ title.
- [ ] Launch from Home Screen: standalone window, cream page background, readable status bar, no browser address bar, no notification permission prompt.
- [ ] Sign in, close and reopen the installed app; verify session behavior, then sign out and verify private views are cleared as before.
- [ ] Open projects, milestones, weekly planner, meals/shopping, Coming Up, routines, Money Tracker and Source Library. Check existing saved content and navigation/back controls.
- [ ] Add/edit/complete a test task, check an in-app reminder, and verify persistence after relaunch. Use disposable records and remove them afterwards.
- [ ] Open a private Source Library file while signed in. Sign out and verify existing access protections remain; the PWA adds no offline file copy.
- [ ] Switch apps and return; verify no unexpected reload or lost unsaved edit.
- [ ] Turn on Airplane Mode: no promise of offline operation or previously cached private data. Restore connectivity and reopen normally.
- [ ] After a later normal Pages deployment, save any edits, close/reopen or reload and confirm the updated UI appears without reinstalling. Allow normal Pages deployment/CDN propagation.
- [ ] Optional Safari Web Inspector: manifest/icons/`sw.js` return 200 under the project subpath; worker scope ends at `/personal-project-hq/`; this worker creates no Cache Storage entries and does not intercept Supabase/file requests.

Physical iPhone installation, standalone session behavior and post-deployment
rollout must be checked on the actual device; Chromium tests cannot certify iOS.
