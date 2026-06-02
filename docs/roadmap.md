# Roadmap

## Short Term

- Add a short demo walkthrough or hosted GitHub Pages link.
- Expand browser checks beyond add-expense persistence into plans, vault, import/export, and reset flows.
- Add more focused tests for month-end settlement, recurring templates, import/export validation, and date handling.
- Improve SAR formatting consistency and isolate all mixed RTL/LTR currency text.
- Review mobile spacing, modal height, and bottom navigation behavior on common phone sizes.

## Medium Term

- Continue extracting storage, normalization, date, and finance calculation helpers from `index.html`.
- Add export/import validation with clearer errors and safer conflict handling.
- Improve recurring obligations and flexible expense tracking.
- Add accessibility checks for labels, focus management, color contrast, and reduced motion.
- Add a proper screenshot/demo section after deployment.

## Longer Term

- Consider a controlled Vue/Vite or React/Vite migration after behavior tests exist.
- Explore optional Firebase/cloud sync with authentication and a privacy/security plan.
- Explore optional model-backed assistant features only after data boundaries, consent, and disclaimers are clear.
- Add encrypted backup or safer local data handling where practical.
- Build a cleaner deployment/demo experience.
