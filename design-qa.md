# Design QA

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

final result: passed
