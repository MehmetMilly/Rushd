# Manual QA Checklist

Use this checklist before publishing changes.

- App opens at `index.html` or local server URL without a blank screen.
- Screenshots in `docs/assets/screenshots/` are refreshed after visible UI changes.
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
