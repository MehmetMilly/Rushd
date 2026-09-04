# Roadmap

## Short Term

- Add a short demo walkthrough or host the built `dist/` output on static hosting.
- Expand browser checks beyond add-expense persistence into plans, vault, import/export, and reset flows.
- Add more focused tests for month-end settlement, recurring templates, import/export validation, and date handling.
- Improve SAR formatting consistency and isolate all mixed RTL/LTR currency text.
- Review mobile spacing, modal height, and bottom navigation behavior on common phone sizes.

## Medium Term

- Move the legacy v1 persistence and finance compatibility code toward P03's typed domain boundary.
- Add export/import validation with clearer errors and safer conflict handling.
- Improve recurring obligations and flexible expense tracking.
- Add accessibility checks for labels, focus management, color contrast, and reduced motion.
- Add a proper screenshot/demo section after deployment.

## Longer Term

- Replace runtime string templates with SFCs only in the owning P05/P06 work.
- Explore optional Firebase/cloud sync with authentication and a privacy/security plan.
- Explore optional model-backed assistant features only after data boundaries, consent, and disclaimers are clear.
- Add encrypted backup or safer local data handling where practical.
- Build a cleaner deployment/demo experience.
