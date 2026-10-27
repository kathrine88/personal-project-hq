# Compact mobile layout

This update consolidates the eight design passes into the component stylesheets and one shared theme. Reminders and Coming Up have tighter headings, card interiors and section gaps. Reload remains available as a labelled ↻ button beside Add. This Week uses the same spacing rhythm, with 44px add, edit and move targets. Navigation uses five equal columns on phones.

The paper texture, forest/russet colours, photographs, application JavaScript and service worker are preserved. There are no database, Edge Function, secret or scheduler deployment steps.

## Review on iPhone after merging

1. In GitHub, open **Actions → pages build and deployment**. Wait for the run for the merge commit to succeed; an older green run does not verify this change.
2. Open [Project HQ](https://kathrine88.github.io/personal-project-hq/) in Safari and reload. The three changed stylesheet URLs use `v=20261027-compact` so the previous CSS URLs are not reused.
3. Open each stylesheet directly. Each must display CSS, rather than a GitHub Pages error:
   - [Shared theme](https://kathrine88.github.io/personal-project-hq/js/design-refresh.css?v=20261027-compact): begins “Project HQ theme and shared layout”, with no numbered design-pass patches.
   - [Coming Up](https://kathrine88.github.io/personal-project-hq/js/coming-up.css?v=20261027-compact): includes `.coming-toolbar-actions`.
   - [Reminders](https://kathrine88.github.io/personal-project-hq/js/reminders.css?v=20261027-compact): notification settings use `margin:6px 0`.
4. In Reminders and Coming Up, check that ↻ is beside Add and that there is no separate reload row below the list. Tap reload, switch Active/Upcoming and History, open/cancel an editor, and check long titles and notes. Verify that a checked to-do still completes and a reminder still dismisses normally. Expand iPhone notifications and check its controls.
5. In This Week, check previous/next/current week, task completion, edit/move, events and meals. Check all five navigation labels remain legible in portrait, landscape and with your usual text size. Confirm the six project photographs still appear.
6. Close and reopen the Home Screen app. The existing worker never caches the page or stylesheets and never forces a reload that could lose an open draft. If an already-open page still looks old, save/cancel drafts and reload it in Safari; do not delete the Home Screen app or its notification subscription.

These changes are not deployed while the PR remains unmerged. Automated checks serve the real HTML/CSS and application modules locally with fixture data; they cannot verify the future production deployment. Physical iPhone Safari review remains recommended.

## Automated review

The existing Coming Up and Reminders browser suites call `tests/mobile-layout.cjs` at 320, 375, 390, 430, 768 and 1440px. It checks horizontal overflow, overlapping navigation/actions, 44px targets, checkbox/title collisions, empty status rows and reload placement. Existing workflow tests still cover reminders, linked plans, recurrence, history, edits and uncertain saves; no live data or pushes are used.

The separate PWA browser suite checks the GitHub Pages subpath, real service worker registration, network-only private requests and updates without losing drafts.

To roll back, revert this PR through GitHub and wait for that Pages deployment. No backend rollback is needed.
