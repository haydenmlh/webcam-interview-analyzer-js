---
description: "Bump patch version and add changelog summary for current changes"
name: "patch"
argument-hint: "Optional note about what changed"
agent: "agent"
---
Perform a patch release update for this repository.

Goal:
- Bump the patch version (X.Y.Z -> X.Y.(Z+1)).
- Summarize the latest implemented changes in CHANGELOG.md.
- Keep version references consistent.

Files to update:
- src/version.js
- README.md (Current app version line)
- CHANGELOG.md

Required workflow:
1. Read the current version from src/version.js.
2. Compute the next patch version.
3. Update src/version.js with the new version.
4. Update README.md to match the new version.
5. Add a new top changelog entry using today's date and concise bullets under Added/Changed/Fixed as applicable.
6. Base the changelog summary on recent implemented code changes (prefer current working changes and recent edits in this session).
7. Run validation commands:
   - npm run lint
   - npm run build
8. Report exactly what was changed, including updated version number and files touched.

Constraints:
- Do not modify unrelated files.
- Preserve existing changelog style and ordering (newest release first).
- Keep summaries concise and factual.
