# Contributing

Thanks for considering a contribution to Rushd / رُشد.

Rushd is currently a static web app. Open `index.html` directly or run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Before opening a pull request, run:

```bash
npm test
```

For browser validation, install dependencies and run:

```bash
npm install
npm run test:browser
```

Also use `docs/manual-qa.md` for manual browser checks.

Please create a branch with a clear name, keep changes focused, and explain what you tested. Arabic copy, RTL layout improvements, accessibility fixes, calculation fixes, documentation, and privacy improvements are welcome.

Do not include real financial data, personal screenshots, backup files, secrets, tokens, or `.env` files in issues or pull requests.
