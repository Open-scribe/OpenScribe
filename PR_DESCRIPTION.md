# feat(pipeline): add verification module

Adds a standalone verification library at `packages/pipeline/verification/`.

Basically it checks clinical notes against the source transcript using token matching - sees if the claims in the note are actually supported by what was said.

## whats in here

- `types.ts` - types for claims, verdicts, etc
- `verifier.ts` - core matching logic (tokenize, overlap calc)
- `note-verifier.ts` - main `verifyNote()` function
- tests for both

## whats NOT touched

Nothing. This is new code only, no changes to existing files.

- no tsconfig changes
- no storage type changes  
- no pipeline wiring

## safe to merge

Its completely isolated. Just a library sitting in its own folder.

## testing

```bash
npx tsx --test packages/pipeline/verification/src/__tests__/*.test.ts
```

13 tests, all pass.
