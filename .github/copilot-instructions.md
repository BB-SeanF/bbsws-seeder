# Copilot Instructions for bbsws-seeder

## Output requirements
- When asked for a script or file, output the FULL file.
- Do not send partial snippets unless explicitly requested.
- Do not wrap code with Markdown fences at the end of files.

## Selector rules
- Use ID-driven selectors only.
- Avoid fuzzy selectors (text, role, nth-child) unless no ID exists.
- Prefer explicit waits on known DOM boundaries.

## Automation boundaries
- Always wait for authoritative UI signals (DOM state), not arbitrary sleeps.
- Treat “Save & Add Another” flows as unstable unless explicitly proven stable.
- Fail fast with clear errors rather than silently continuing.
- Always take a screenshot on failure (error.png).

## TinyMCE
- Always use the Source (“<>”) dialog to insert HTML.
- Never type directly into the iframe body.

## Photos
- Photos is fragile.
- Default to single-album-per-run.
- Do not attempt multi-album persistence unless explicitly instructed.

## Style
- Keep console output minimal and high-signal.
- Preserve existing patterns unless explicitly told to refactor.