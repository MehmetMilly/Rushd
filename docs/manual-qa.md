# Manual QA Checklist

Use this checklist before publishing changes.

- App opens at `index.html` or local server URL without a blank screen.
- Screenshots in `docs/assets/screenshots/` are refreshed after visible UI changes.
- Optional browser smoke test passes with `npm run test:browser`.
- Browser console has no relevant app errors.
- Arabic RTL layout works on the dashboard.
- English mode can be selected and the UI still renders.
- Add a manual expense.
- Mark an expense as paid and verify the paid amount appears.
- Edit an expense if the edit flow is available.
- Delete an expense only after confirmation.
- Add or edit a recurring plan template.
- Apply templates to a month and review create/update/delete counts.
- Add a flexible expense definition and verify usage/budget summaries.
- Add a savings vault goal.
- Move month-end surplus to the vault or budget when prompted.
- Data persists after refresh.
- Export backup downloads JSON.
- Import backup shows confirmation and updates data.
- Factory reset asks for confirmation before deleting data.
- Mobile width around 390px renders without overlapping bottom navigation.
- Desktop width renders the app shell without clipping key controls.
- SAR values are readable in RTL context.
- Empty states are clear.
- No real user financial data, secrets, or private backup files are committed.

## P01 Task 3 — stability and truthfulness checks

Recorded for the P01 closure commit. Run in a real browser in both Arabic and English.

- Date scroller highlights today as the local civil day (check shortly after local midnight: the day must not lag behind).
- Selecting a day at the end/beginning of a month shows the right month's totals (local month bounds).
- Settings shows only the monthly budget field; the weekly "divide by 4" safe-to-spend toggle is gone and Home shows the monthly amount.
- Template form with recurrence "monthly" requires a day of month (1–31); saving without it shows a bilingual warning and saves nothing.
- Plan screen shows the assigned plan with its effective date; days before that date do not adopt the plan.
- Profile panel (top bar person icon) shows the Momentum placeholder in both languages and contains no XP, levels, or badges.
- Factory reset dialog states exactly what the pre-reset backup includes and that language/onboarding preferences are not included (both languages).

## P01 review-fix QA record — 2026-09-03

Performed in a real browser (Chromium via the ZCode in-app browser, viewport 1280×720) against
`http://127.0.0.1:8124` serving the working tree after the review fixes, with a fresh empty
IndexedDB profile. Both languages were exercised (Arabic first, then switched to English).

| Check | Language | Action | Observed result |
| --- | --- | --- | --- |
| Historical budget unavailable (Home) | ar | Skipped onboarding, selected 2026-08-15 (a past month with no recorded allowance snapshot) | Hero amount area shows «غير مسجلة» instead of a number; no budget-derived figure is shown |
| Historical budget unavailable (Home) | en | Selected the same past date in English mode | Hero shows "Not recorded" |
| Historical budget unavailable (Statistics) | ar | Opened Statistics for the past month | Month Snapshot card shows «ميزانية هذا الشهر السابق غير مسجلة» with the explanation that budget/safe-to-spend cannot be shown truthfully and that the month-end settlement for it is blocked; budget metrics are hidden |
| Historical budget unavailable (Statistics) | en | Opened Statistics in English mode | Card shows "This past month's budget was not recorded" plus the equivalent English explanation; budget metrics hidden |
| Blocked historical Auto-Fill | ar | With 2026-08-15 selected, pressed «ملء تلقائي» | Toast «الملء التلقائي غير متاح للتواريخ السابقة…» appears; zero expenses generated for that date (verified in the visible list and IndexedDB) |
| Blocked historical Auto-Fill | en | Pressed Auto-Fill on the same past date | English toast: "Auto-Fill is not available for past dates: the rules in effect back then are not preserved…" |
| Monthly scheduling validation | ar | Plans → add monthly template with no day, submit | Day-of-month field is shown for monthly recurrence; submitting without it toasts «اختر يومًا من 1 إلى 31 للقالب الشهري», the form stays open, and no template is saved |
| Profile / Momentum containment | ar | Opened «ملفك الشخصي» after reload | Panel shows «مومينتوم — قيد إعادة البناء» placeholder; no XP, level, or badges anywhere |
| Profile / Momentum containment | en | Opened "Your Profile" in English mode | Panel shows "Momentum — being rebuilt" with the English placeholder text |
| Export filename and flow | ar | Settings → «تصدير نسخة احتياطية» (anchor clicks observed) | Production flow created a blob download named `rushd-backup-2026-09-03.json` — the local civil date, not a UTC-derived date |
| Reset wording and cancellation | ar | Opened «إعادة ضبط المصنع» | Dialog lists exactly what the backup includes and states language/onboarding preferences are not included; cancelled with «إلغاء»; data unchanged |
| Reset wording and cancellation | en | Opened "Factory Reset" in English mode | Equivalent English wording; cancelled; data unchanged |
| Ordinary capture and reload | ar | Added expense «قهوة الجودة» for ١٢٫٥ via the add modal, then reloaded the page | Amount stored as 12.5; expense still on today's list after reload; onboarding does not reappear |

## P01 second review-fix QA record — 2026-09-03

Performed in a real browser (Chromium via the ZCode in-app browser, viewport 1280×800) against
`http://127.0.0.1:8124` serving the working tree, starting from a wiped profile (fresh IndexedDB
and localStorage). Arabic first, then switched to English through the Settings language toggle.
A legacy dayless monthly template was seeded through the production storage layer
(`MicroSaveDB.saveTemplate`) to reproduce an existing IndexedDB record predating the day rule.

| Check | Language | Action | Observed result |
| --- | --- | --- | --- |
| Onboarding day requirement | ar | Continued past the budget step, filled a monthly item name and cost, left the day input empty (it starts empty, not day 1), pressed «إضافة عنصر» | Toast «اختر يومًا من 1 إلى 31 للقالب الشهري»; the item is not added |
| Onboarding day requirement | ar | Entered day 15 and pressed «إضافة عنصر» again, then finished setup | Item appears as «يوم الشهر 15»; setup saves («تم حفظ الإعداد الأولي») and the allowance snapshot for 2026-09 is recorded |
| Blocked month-end settlement explanation | ar | Reloaded after setup (previous month 2026-08 has no snapshot and no settlement) | Toast «تسوية أغسطس ٢٠٢٦ غير متاحة: ميزانية الشهر السابق غير مسجلة، لذلك لا يمكن حساب فائض موثوق.»; a second reload the same day stays silent (prompt deferred) |
| Legacy template warning (Plans list) | ar | Opened Plans, expanded «العناصر الشهرية» | The seeded «قالب قديم بدون يوم» row shows the warning «قالب شهري بدون يوم: اختر يومًا من 1 إلى 31 حتى يعمل» instead of a day list |
| Legacy template editor block and repair | ar | Clicked the dayless row; tried to update without a day; then entered day 10 and updated | Editor shows the day field with the warning; update without a day toasts «اختر يومًا من 1 إلى 31 للقالب الشهري» and keeps the modal open; with day 10 the save succeeds and the row shows «شهرياً · 10» with no warning |
| Variance reward removal | ar | Added expense «قهوة اختبار» (expected 50) and paid 20 via the pay numpad (positive variance, the old confetti trigger) | Payment commits (hero updates to 730.00); zero `.confetti` elements exist at any point; no celebratory animation appears |
| Historical budget route (Home) | ar | Selected 2026-08-20 | Hero shows «غير مسجلة» with the hint «اضغط لعرض السبب»; the hero is a button that routes to Statistics |
| Historical budget explanation (Statistics) | ar | Opened Statistics for the past month | Month Snapshot shows «ميزانية هذا الشهر السابق غير مسجلة» with the full explanation ending «ميزانية اليوم لا تُستخدم أبدًا كحقيقة تاريخية» |
| Blocked month-end settlement explanation | en | Switched to English, cleared the same-day deferral, reloaded | English toast: "Settlement for August 2026 is unavailable: last month’s budget was not recorded, so no trustworthy surplus can be calculated." |
| Historical budget route (Home) | en | Selected 2026-08-20 in English mode | Hero shows "Not recorded" with the hint "Tap to see why" |
| Legacy template warning (Plans list) | en | Opened Plans → Monthly in English mode | The seeded "QA legacy no day" row shows "Monthly template without a day: choose a day from 1 to 31 to make it work" |
| Legacy template editor block | en | Opened the dayless template's editor and pressed Update without a day | "DAY OF MONTH" field shows the English warning; update toasts "Choose a day from 1 to 31 for the monthly template" and the modal stays open; closed without saving |
| Onboarding day requirement | en | Settings → "Open Setup" → Continue → monthly item with empty day (day input starts empty) → Add | Toast "Choose a day from 1 to 31 for the monthly template"; the item is not added; skipped setup afterwards with data unchanged |
