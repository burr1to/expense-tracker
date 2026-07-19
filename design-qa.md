# Design QA

## Latest QA result — Login password visibility — 2026-07-20

- Source visual truth: `/tmp/codex-clipboard-6a9b21e0-6699-49fe-8ca0-17fe7391ae70.png`
- Implementation screenshot: unavailable because the in-app browser could not reach the running local preview
- Intended viewport: 1716 × 620
- State: sign-in form with an empty password field

### Full-view comparison evidence

Blocked. The source screenshot was opened at its original resolution, but the in-app browser returned a connection error for the running local Next.js preview. A browser-rendered implementation screenshot could not be captured and combined with the source for the required visual comparison.

### Focused-region comparison evidence

Blocked for the same reason. Code inspection confirms the left-side headline now uses a comma, the password field has a password-specific muted placeholder style, and the existing Phosphor eye/eye-slash control has a visible dark-theme color. Code inspection is not a substitute for browser-rendered visual evidence.

### Findings

- [P2] Final password-field contrast and interaction remain visually unverified.
  - Location: sign-in password field and visibility toggle.
  - Evidence: the focused source region was inspected, but the implementation could not be captured in the browser.
  - Impact: the exact placeholder dimness and icon contrast cannot be signed off against the source screenshot.
  - Fix: capture the sign-in form at 1716 × 620 when the in-app browser can reach the local preview, test both masked and revealed states, and compare the focused password-field region with the source.

### Comparison history

- Pass 1: blocked before visual comparison because the in-app browser could not connect to the local preview.

### Primary interactions tested

- Static component inspection confirms the control switches the input between masked and visible states through Mantine's controlled `visible` API.
- The visibility control now exposes dynamic `Show password` and `Hide password` accessible names and is keyboard-focusable.
- ESLint, TypeScript, and the optimized production build passed.
- Browser interaction and console checks were blocked by the local-preview connection failure.

### Follow-up polish

- None identified without rendered evidence.

final result: blocked

---

## Latest QA result — Compact monthly breathing room — 2026-07-20

- Source visual truth: `/tmp/codex-clipboard-3130656c-2da0-4e2e-b8fb-4337382dfa6b.png`
- Implementation screenshot: unavailable because the in-app browser could not reach the running local preview
- Intended viewports: desktop and 390 × 844 mobile
- State: dashboard with the monthly breathing room summary rendered after the Daily rhythm grid

### Full-view comparison evidence

Blocked. The local Next.js preview returned HTTP 200 and the production build completed, but the in-app browser returned a connection error for the preview. A browser-rendered implementation screenshot could not be captured, so the source and implementation could not be combined into the required visual comparison.

### Focused-region comparison evidence

Blocked for the same reason. Code inspection confirms the section now contains only `Income this month`, `Expenses this month`, `Upcoming in`, and `Upcoming out`; however, code inspection is not a substitute for browser-rendered visual evidence.

### Findings

- [P2] Visual density and responsive layout remain unverified.
  - Location: dashboard Monthly breathing room section.
  - Evidence: the component and responsive CSS were updated, but no implementation screenshot could be captured.
  - Impact: desktop spacing, mobile wrapping, and the neutral surface treatment cannot be signed off visually.
  - Fix: reopen the local preview when the in-app browser can reach it, capture desktop and 390 × 844 screenshots, compare them with the source, and resolve any visible mismatch.

### Comparison history

- Pass 1: blocked before visual comparison because the browser could not connect to the local preview.

### Primary interactions tested

- No new interactive control remains in this summary.
- ESLint passed.
- All 27 Vitest tests passed.
- The optimized production build and TypeScript checks passed.

### Follow-up polish

- None identified without rendered evidence.

final result: blocked

---

## Latest QA result — Borderless transaction filters — 2026-07-20

- Source visual truth: `/tmp/codex-clipboard-3a70dcb0-1341-4413-8673-20fb2ead1964.png`
- Desktop implementation screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-filters-borderless-desktop.png`
- Mobile implementation screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-filters-borderless-mobile-viewport.png`
- Side-by-side evidence: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-filters-borderless-comparison.png`
- Viewports: 1451 × 800 desktop and 390 × 844 mobile
- State: July 2026 dark theme; filters cleared

### Full-view comparison evidence

The implementation preserves the source transaction scope, search field, filter heading, six filter controls, clear action, and ledger boundary while removing only the advanced-filter wrapper’s border, background, rounded corners, padding, and mobile negative margin. The result reads as one continuous page section rather than a card nested inside the transaction page.

### Focused-region comparison evidence

- Fonts and typography: existing Manrope labels, control copy, and heading hierarchy are unchanged.
- Spacing and layout rhythm: the six-column desktop grid and two-column mobile grid remain intact; removing inset padding aligns the filter heading and controls with the surrounding search and ledger content.
- Colors and visual tokens: individual inputs keep their existing dark surfaces and borders; the redundant outer surface is transparent and borderless.
- Image quality and asset fidelity: no raster assets are used in this section; the existing Phosphor filter icon remains unchanged.
- Copy and content: all labels, values, and the `Clear filters` action are unchanged.

### Comparison history

- Pass 1: passed. The focused side-by-side comparison shows the requested outer box removed with no actionable P0, P1, or P2 regressions.

### Primary interactions tested

- Entered a minimum amount of `5000` and verified the result count changed from 12 to 6 entries and `Clear filters` became enabled.
- Clicked `Clear filters` and verified the amount cleared, the result count returned to 12, and the action became disabled.
- Verified the mobile filter grid remains two columns with no horizontal overflow at 390 px.
- Checked browser logs; no application errors or warnings were recorded.
- ESLint, TypeScript, and the optimized production build passed.

### Follow-up polish

- No remaining P0, P1, P2, or P3 findings.

final result: passed

---

## Latest QA result — Calendar net cells — 2026-07-20

- Source visual truth: `/tmp/codex-clipboard-227e9f4d-336c-4b37-9d6c-dce4eaaae571.png`
- Implementation screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/calendar-net-cells-final.png`
- Side-by-side evidence: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/calendar-net-cells-comparison-final.png`
- Viewport: 1440 × 900
- State: July 2026 dark theme; July 18 selected with one expense

### Full-view comparison evidence

The revised calendar keeps the source layout, month navigation, weekday grid, day positioning, dark palette, type hierarchy, and spacious rhythm. Dates with activity now use a full semantic green or red tile, and each tile contains only one signed net value in `NPR …` form. The selected tile retains its semantic fill with a blue focus outline. The selected day’s income, expenses, net, and transaction breakdown appear in the adjacent detail panel.

### Focused-region comparison evidence

- Fonts and typography: existing Manrope hierarchy and compact calendar-label weights remain consistent; the net value is a single compact line without the redundant `Net` label.
- Spacing and layout rhythm: tile dimensions, radii, calendar grid, date alignment, and side-panel separation remain consistent with the source.
- Colors and visual tokens: positive and negative tiles use the existing green and coral tokens as full tinted surfaces with readable dark-theme contrast; selection no longer replaces the semantic fill.
- Image quality and asset fidelity: no raster or custom visual assets are used by this interface; existing Phosphor navigation icons remain unchanged.
- Copy and content: grid cells show only `NPR 430` or `NPR −23K`; full Income, Expenses, Net, and entry details appear only in the selected-day panel.

### Comparison history

- Pass 1: one P2 copy issue remained in the side panel: a single transaction rendered as `1 entries`.
- Fix: added singular/plural handling so the panel now renders `1 entry`.
- Pass 2: passed. The post-fix screenshot and DOM snapshot show the corrected heading, full green/red cell fills, one net amount per date, selected-day totals, and individual entries.

### Primary interactions tested

- Clicked the positive July 16 tile and verified the panel showed two entries plus Income `NPR 3,430`, Expenses `NPR 3,000`, and Net `NPR 430`.
- Clicked the negative July 18 tile and verified the panel changed to one entry plus Income `NPR 0`, Expenses `NPR 23,000`, and Net `NPR −23K`.
- Verified the selected outline moved between dates without replacing the semantic tile fill.
- Checked browser logs; no application errors were recorded. Electron emitted only its environment-level development CSP warning.
- Calendar unit tests, ESLint, TypeScript, and the optimized production build passed.

### Follow-up polish

- No remaining P0, P1, P2, or P3 visual findings.

final result: passed

---

## Latest QA result — Daily activity placement — 2026-07-19

- Source visual truth: `/tmp/codex-clipboard-164adcdf-73fa-4f0d-b968-c0ac7911adb9.png`
- Implementation screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/dashboard-day-activity-desktop.jpg`
- Mobile screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/dashboard-day-activity-mobile.jpg`
- Side-by-side evidence: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/dashboard-day-activity-comparison.jpg`
- Viewports: 1920 × 1080 desktop target and 390 × 844 mobile target; captured browser content areas were 1905 × 964 and 375 × 812
- State: local demo ledger, July 10 selected, three transactions visible

### Full-view comparison evidence

The source shows the selected day's transaction block after planning and insights at the bottom of the dashboard. The implementation intentionally moves the entire block directly beneath the large Net saved summary, before spending overview, categories, plans, and insights. The day label, entry count, Full history action, transaction rows, empty state, and date-prefilled add action remain intact.

### Focused-region comparison evidence

- Fonts and typography: existing Manrope display and compact transaction-row hierarchy are unchanged.
- Spacing and layout rhythm: Net saved now has a 32 px desktop handoff into a divided activity section, followed by a 48 px break before the analytical cards. Mobile uses the existing compact activity treatment with a 16 px break before Spending overview.
- Colors and visual tokens: the implementation reuses the existing paper, ink, line, blue, green, and coral tokens with no palette changes.
- Image quality and asset fidelity: this area contains no raster product imagery. Existing Phosphor category and action icons remain unchanged.
- Copy and content: the selected date, entry count, Full history label, transaction details, and empty-state copy are unchanged.
- Responsive behavior: the 390 px target shows Net saved, all three selected-day transactions, and the start of Spending overview in the intended order without horizontal overflow.

### Findings

No actionable P0, P1, or P2 differences remain. The information-order change is the requested intentional deviation from the source screenshot.

### Comparison history

- Pass 1: passed. The affected desktop region and focused mobile capture show the selected day's activity directly below Net saved, with no clipping, overlap, or horizontal overflow.

### Primary interactions tested

- Rendered the dashboard with a selected day containing three transactions.
- Confirmed the DOM and visual order is Net saved → selected-day activity → Spending overview.
- Confirmed the transaction list remains visible and preserves its Full history action.
- Checked the mobile breakpoint at 390 × 844.
- Checked browser console errors; none were recorded.
- ESLint, all 18 Vitest tests, TypeScript, and the optimized production build passed.

### Follow-up polish

- None.

final result: passed

---

## Latest QA result — Transactions month scope and visible filters — 2026-07-19

- Source visual truth: `/tmp/codex-clipboard-bf1c2dba-e0a3-4c5a-8cce-2f0b34262682.png`
- Implementation screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-month-filters-desktop.png`
- Mobile screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-month-filters-mobile.png`
- Side-by-side evidence: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-month-filters-comparison.png`
- Viewports: 1920 × 1080 desktop and 390 × 844 mobile
- State: authenticated sample ledger, July 2026, dark theme, Expense tab selected for interaction and mobile checks

### Full-view comparison evidence

The updated screen preserves the reference's Paper Ledger navigation, dark surface, Manrope hierarchy, action placement, transaction rows, semantic income/expense colors, and compact timeline. The intentional changes are clearly separated: month navigation now defines the ledger scope, All/Expense/Income remain visible type tabs, and the six detailed filters are permanently visible in their own panel. The former More disclosure is gone.

### Focused-region comparison evidence

- Fonts and typography: Manrope, display weights, compact metadata, and small filter labels remain consistent with the source. The month is promoted clearly without competing with the Transactions title.
- Spacing and layout rhythm: month scope and type tabs share one row on desktop; search and the filter panel follow in a predictable vertical sequence. The six fields fit within the desktop card, while mobile uses a two-column filter grid with no page-level horizontal overflow.
- Colors and visual tokens: the implementation reuses the existing paper, ink, line, blue, green, and coral tokens in both themes. Active type tabs preserve the existing selected treatment.
- Image quality and asset fidelity: the source contains no raster product imagery. All controls continue to use the existing Phosphor icon family; no custom SVG, CSS-drawn, or placeholder assets were introduced.
- Copy and content: the search placeholder and result count name the selected month. Empty-state copy identifies both the selected type and month.
- Accessibility and behavior: month arrows remain visible on mobile, tabs expose `aria-pressed`, filters have a named region, and Clear filters has a meaningful disabled state.

### Findings

No actionable P0, P1, or P2 visual differences remain. The added month row and permanently visible filter panel are intentional product changes requested by the user.

### Comparison history

- Pass 1: blocked by a P1 dark-theme contrast issue. Mantine's default input surface overrode the ledger's dark input token, leaving filter values faint on a light field.
- Fix: added a dark-theme Mantine input override using the existing paper, line, ink, and muted tokens.
- Pass 2: passed. The revised desktop capture shows dark, legible search and filter fields. The reference and implementation were combined into one side-by-side comparison, and focused mobile inspection confirmed the month arrows, equal-width tabs, and two-column filter grid remain usable at 390 px.

### Primary interactions tested

- Confirmed the default July scope shows only July transactions.
- Selected Expense and verified the result count changed from 12 to 11 and the salary entry disappeared.
- Moved to June and verified the list changed to the June empty state while Expense remained selected.
- Returned to the current month by clicking the month label.
- Verified all six detailed filters are visible without opening another menu.
- Checked the browser console; no application errors were recorded.
- ESLint, all 18 Vitest tests, TypeScript, and the optimized production build passed.

### Follow-up polish

- P3: very long select values may truncate on the narrowest mobile width, which is preferable to widening the filter card or introducing horizontal scroll.

final result: passed

---

- Source visual truth: `/home/burrito/.codex/generated_images/019f5015-e81c-7be0-a5df-c18f717fb0c6/exec-e2f39938-d3c6-4b99-b858-d28c2d94dc01.png`
- Implementation screenshot: `/home/burrito/Documents/expense-tracker/artifacts/dashboard-mobile-final.png`
- Side-by-side evidence: `/home/burrito/Documents/expense-tracker/artifacts/design-comparison-final.png`
- Desktop evidence: `/home/burrito/Documents/expense-tracker/artifacts/dashboard-desktop.png`
- Expanded mobile evidence: `/home/burrito/Documents/expense-tracker/artifacts/dashboard-expanded-qa-viewport.png`
- Expanded comparison evidence: `/home/burrito/Documents/expense-tracker/artifacts/design-comparison-expanded-final.png`
- Calendar evidence: `/home/burrito/Documents/expense-tracker/artifacts/calendar-mobile.png`
- Dark-theme evidence: `/home/burrito/Documents/expense-tracker/artifacts/settings-dark-mobile.png`
- Viewport: 390 × 844 mobile; 1280 × 900 desktop resilience check
- State: authenticated demo ledger, July 2026, default NPR currency

## Full-view comparison evidence

The final side-by-side comparison preserves the reference's defining hierarchy: month and date, three-value summary strip, oversized net-savings figure, blue savings annotation, pale-bar and blue-line weekly spending chart, compact recent-transaction rows, and centered floating add control. The desktop adaptation expands this into a persistent sidebar and two-column analysis region without changing the mobile information order.

The implementation intentionally uses live ledger totals instead of copying the mock's fixed values. It also calls the second destination Reports rather than Overview because the completed product gives that destination category and historical analysis.

## Focused-region comparison evidence

- Typography: Manrope's wide numerical forms, heavy display weights, compact uppercase section labels, and small neutral metadata closely match the reference. No clipping or unintended wrapping remains at 390 px.
- Spacing and layout: the initial implementation was too tall. Mobile section padding, activity-row density, nav height, and chart proportions were reduced until all five visible activity rows and the primary navigation fit the selected mobile composition.
- Colors and tokens: warm paper, dark navy text, cobalt actions, green income, coral expenses, fine warm-gray dividers, and pale chart bars match the source palette and maintain accessible contrast.
- Image and icon fidelity: the reference contains no raster imagery. All interface icons use one consistent Phosphor icon family; there are no emoji, custom SVGs, CSS-drawn icons, or placeholder assets.
- Copy: app-specific labels are concise and standalone. Dynamic totals, dates, notes, and categories come from the ledger model.

## Comparison history

### Pass 1 — blocked

- P2: the dashboard was 1,287 px tall at a 390 × 844 viewport, so the source's compact at-a-glance composition was lost.
- P2: the chart used a filled area only, while the source used pale vertical bars, a blue line, and visible points.
- Fixes: tightened mobile rhythm and row density; simplified redundant mobile subheadings; reduced bottom navigation height; replaced the area chart with a composed bar-and-line chart; limited the dashboard chart to the latest seven spending days.

### Pass 2 — passed

- Post-fix evidence shows the full five-row activity block, chart, summaries, and floating action in the intended mobile composition.
- No actionable P0, P1, or P2 visual differences remain.

## Primary interactions tested

- Entered demo mode from the auth screen.
- Added an expense and verified updated totals and history.
- Reloaded the page and verified that the saved entry persisted.
- Opened Reports and verified category and income-versus-expense charts.
- Opened Transactions and verified search/filter/edit/delete affordances.
- Opened Profile and verified currency choices, CSV export control, demo reset, and sign out.
- Checked the browser console; no application errors were recorded. The only warning observed was the Codex host Electron development CSP warning, which is outside the app bundle.
- Confirmed a pending recurring entry and verified its next due date advanced by one month.
- Verified category budgets against actual monthly spending.
- Added money to a savings goal and verified progress updated.
- Opened the daily calendar and verified transaction totals and selected-day details.
- Applied category, date, amount, and tag filter controls; verified an `essential` tag filter reduced the result set.
- Verified CSV parsing and row-level validation through automated tests and the import-preview UI.
- Created and rendered a custom category, then restored the clean demo state.
- Switched to dark mode and verified the responsive settings surface.
- Hid and revealed monetary values with the global privacy control.
- Locked and unlocked the ledger in demo mode.
- Verified mobile navigation and desktop navigation reset the page to the top on view changes.

## Follow-up polish

- P3: the source prints numeric labels directly over every chart point; the implementation uses a tooltip to keep dynamic values from colliding on narrow screens.
- P3: the reference includes a short blue date underline; the implementation relies on spacing and divider rhythm instead.
- P3: the new privacy button occupies the reference's otherwise empty top-right corner; it is intentionally persistent because shoulder-surfing protection must stay one tap away.

dashboard final result: passed

---

# Profile workspace QA — 2026-07-15

- Source visual truth: `/tmp/codex-clipboard-ecb4fd1c-4a95-44d2-b14d-48f7da001642.png`
- Implementation screenshot: unavailable because the authenticated ledger API fails before the Profile view can render
- Blocker screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/profile-qa-blocked.png`
- Viewport: 1280 × 720 desktop
- State: authenticated local QA account; application stopped at the ledger error state

## Full-view comparison evidence

The reference image was opened and inspected. The implementation could not be captured in the same Profile state, so no valid side-by-side visual comparison was possible.

## Focused-region comparison evidence

- Fonts and typography: blocked; the updated Profile view did not render.
- Spacing and layout rhythm: code inspection confirms a 32 px desktop section inset, a single shared workspace boundary, and divider-based section separation, but rendered evidence is unavailable.
- Colors and visual tokens: the change reuses the existing `--line` and paper-surface tokens; rendered evidence is unavailable.
- Image quality and asset fidelity: the target contains no raster assets; existing Phosphor icons are unchanged.
- Copy and content: unchanged.

## Findings

- [P0] Profile visual verification is blocked by existing database drift.
  Location: authenticated app load before the Profile view.
  Evidence: `/api/ledger` fails because the current database does not contain `Transaction.subcategory`; the browser then displays “We couldn’t load your ledger.”
  Impact: the updated Profile workspace cannot be reached for screenshot comparison or interaction testing.
  Fix: apply the already-present `20260715030000_add_subcategories_and_payment_accounts` migration in the appropriate environment, then repeat Profile capture and comparison.

## Comparison history

- Pass 1: blocked before the Profile view rendered; no visual fixes were inferred from the error screen.

## Primary interactions tested

- Created a disposable local QA account and authenticated successfully.
- Confirmed the application reaches the ledger request.
- Checked browser logs; no application-side console errors were emitted before the server-side API failure.
- Profile controls could not be tested because the ledger API failure replaces the requested view.

## Follow-up polish

- None assessed until rendered Profile evidence is available.

final result: blocked

---

# Latest QA result — Transactions

The current task's complete comparison, focused evidence, interaction coverage, and two-pass fix history are recorded in “Transactions readability and filtering QA — 2026-07-16” above.

- Source: `/tmp/codex-clipboard-b5b95329-c0a1-4f1d-a8e2-94047a69fcb0.png`
- Implementation: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-filters-final.png`
- Side-by-side: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-design-comparison.png`
- Viewport/state: 1360 × 768, light theme, Expense filters expanded
- Remaining actionable P0/P1/P2 findings: none

final result: passed

---

# Amount field focus QA — 2026-07-18

- Source visual truth: `/tmp/codex-clipboard-25d3a9fc-2c94-41aa-bd1a-33577e199360.png`
- Implementation screenshot: unavailable because the in-app browser is not authenticated
- Viewport: desktop amount-field crop, focused state
- State: signed-out local app; the transaction form requires an authenticated ledger

## Full-view comparison evidence

The source crop shows two issues: a redundant formatted amount below the control and the global rounded focus ring appearing inside an underline-style amount field. The updated authenticated form could not be captured in the same state, so a valid side-by-side comparison was not possible.

## Focused-region comparison evidence

- Fonts and typography: the existing 42 px desktop and 37 px mobile amount sizes and weights are preserved.
- Spacing and layout rhythm: the redundant value row was removed; validation messages remain in the same position.
- Colors and visual tokens: focus now uses the existing `--blue` token on the field underline.
- Image quality and asset fidelity: this control contains no image assets.
- Copy and content: the currency prefix and entered amount remain; the duplicate formatted amount is removed.

## Findings

- [P0] Rendered focus-state verification is blocked.
  Location: add/edit transaction amount field.
  Evidence: the local app reaches the sign-in screen, while the transaction sheet requires an authenticated session.
  Impact: the exact rendered focus state cannot be compared against the supplied crop.
  Fix: sign in locally, open Add transaction, enter an amount, and repeat the focused-state capture.

## Comparison history

- Pass 1: source inspected and implementation updated; rendered comparison remains blocked before the transaction form can be reached.

## Primary interactions tested

- ESLint passed.
- All 13 Vitest tests passed.
- The optimized production build passed.
- The reachable signed-out screen loaded without an application console error.

## Follow-up polish

- None assessed until the authenticated form can be rendered.

final result: blocked

---

# Transactions readability and filtering QA — 2026-07-16

- Source visual truth: `/tmp/codex-clipboard-b5b95329-c0a1-4f1d-a8e2-94047a69fcb0.png`
- Focused source references: `/tmp/codex-clipboard-3cbb94ef-2e5f-40b0-99bf-416d03d6d8ea.png`, `/tmp/codex-clipboard-c06935b2-8bfb-469f-8f80-c8fbd3f03d72.png`
- Implementation screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-filters-final.png`
- Receipt modal screenshot: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/receipt-preview-modal.png`
- Side-by-side evidence: `/home/burrito/Desktop/Projects/expense-tracker/artifacts/transactions-design-comparison.png`
- Viewport: 1360 × 768 desktop
- State: light theme, expanded advanced filters, Expense selected, realistic NPR transaction data

## Full-view comparison evidence

The final comparison preserves the existing Paper Ledger navigation, typography, warm paper surface, action hierarchy, and transaction timeline while deliberately widening the content region. The advanced filters now fit within their boundary, and each full transaction row has a clear title plus a wrapping metadata line for category/subcategory, location, payment mode, date, and receipt.

## Focused-region comparison evidence

- Fonts and typography: the implementation retains Manrope and the existing display hierarchy. Transaction titles are 15 px and metadata is 12 px, with enough vertical separation to remain legible without changing the product's character.
- Spacing and layout rhythm: global page width increases from 1180 px to 1440 px. Full transaction rows increase to a 96 px minimum height, while dashboard rows explicitly retain their compact treatment. The filter card uses six flexible columns and an internal footer action, so no field or action overflows at the target viewport.
- Colors and visual tokens: all work reuses `--paper`, `--paper-strong`, `--ink`, `--muted`, `--line`, `--blue`, `--green`, and `--coral`. No new unrelated palette was introduced.
- Image quality and asset fidelity: the source has no raster product imagery. Interface icons continue to use the existing Phosphor family. The receipt modal uses the authenticated receipt endpoint for the original image or PDF rather than a generated or placeholder asset.
- Copy and content: search copy is shortened to “Search transactions”; the type-aware label changes to “Expense category” or “Income category”; amount inputs expose the current currency code; subcategory remains transaction metadata and is intentionally not added as another filter.

## Findings and comparison history

### Pass 1 — blocked

- [P2] “Clear all” overflowed the right edge of the advanced-filter card at 1360 px.
- Fix: removed the seventh grid track and moved the action to a compact full-width footer row inside the filter card.

### Pass 2 — passed

- Post-fix evidence shows all six filter controls and “Clear all” contained within the card.
- Expense category options were opened and verified to contain only Housing, Food & Dining, Transport, Utilities, Shopping, Health, Entertainment, Education, Travel, and Other; income categories were absent.
- No actionable P0, P1, or P2 visual differences remain. The wider page and expanded transaction density are intentional changes requested by the user.

## Primary interactions tested

- Opened and closed the advanced filters.
- Selected Expense and verified the result count and type-specific Category label.
- Opened the Expense category dropdown and verified its complete option set.
- Verified both amount fields expose an `NPR` prefix and accessible currency-specific labels.
- Opened the receipt preview as an in-site modal and verified its dialog title, close control, backdrop, image/PDF canvas, and Escape support. The visual harness used a non-persistent receipt ID, so authenticated file bytes were not part of the visual fixture.
- Checked the final clean preview state; no new application console errors were recorded. Earlier hydration messages were produced only by the first temporary QA harness and did not recur in the corrected capture.
- ESLint, all 13 Vitest tests, TypeScript, and the optimized production build passed after the QA harness was removed.

## Follow-up polish

- P3: a very long payment-account label may still truncate inside its filter input, which is preferable to widening or overflowing the filter card.

final result: passed

---

# Daily transaction history QA — 2026-07-16

- Source visual truth: `/tmp/codex-clipboard-e4fb029d-817d-4f99-9257-791405e2cfa0.png`
- Implementation screenshot: unavailable because the in-app browser is not authenticated
- Viewport: 390 × 844 mobile
- State: signed-out local app; the authenticated dashboard could not be reached without creating or using an account

## Full-view comparison evidence

The source screenshot was opened at its original resolution. The updated authenticated dashboard could not be captured in the same state, so a valid side-by-side comparison was not possible.

## Focused-region comparison evidence

- Fonts and typography: the header continues to use the existing Manrope styles and sizes; rendered comparison is blocked.
- Spacing and layout rhythm: the date trigger keeps the existing mobile header position and compact spacing; rendered comparison is blocked.
- Colors and visual tokens: the trigger and popover reuse `--muted`, `--ink`, `--blue`, `--line`, and paper-surface tokens.
- Image quality and asset fidelity: the target has no raster assets; the added caret uses the app's existing Phosphor icon family.
- Copy and content: the chosen day is displayed in the same `EEEE, MMMM d` format, and the activity section identifies the selected date and its entry count.

## Findings

- [P0] Signed-in visual and interaction verification is blocked.
  Location: dashboard day picker and daily transaction list.
  Evidence: the in-app browser reaches the sign-in screen, while creating or using an account would require user authorization or credentials.
  Impact: calendar opening, day selection, list filtering, and exact mobile layout could not be verified in the rendered app.
  Fix: sign in to the local app, select a date with transactions, and repeat the 390 × 844 capture and interaction check.

## Comparison history

- Pass 1: blocked before the authenticated dashboard rendered; no visual fixes were inferred from the sign-in screen.

## Primary interactions tested

- Static checks passed: ESLint, all 12 Vitest tests, TypeScript, and the production build.
- Browser console showed no application errors on the reachable signed-out screen.
- Authenticated day-picker interactions were not tested.

## Follow-up polish

- None assessed until rendered dashboard evidence is available.

final result: blocked

---

# Current handoff result — Transactions

The complete current-task report is recorded in “Transactions readability and filtering QA — 2026-07-16.” Its source, implementation, side-by-side evidence, focused comparison, interaction checks, and two-pass fix history are all present above.

- Remaining actionable P0/P1/P2 findings: none

final result: passed
