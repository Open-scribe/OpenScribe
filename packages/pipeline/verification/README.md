# verification

Validates clinical notes against source transcripts using token matching.

Not wired into the pipeline yet - just a standalone lib.

## quick example

```typescript
import { verifyNote } from './src/note-verifier'

const result = await verifyNote(
  'Patient has headache for 3 days.',
  'Patient reported headache lasting 3 days.'
)

console.log(result.status)  // 'verified' | 'partial' | 'failed'
```

## how it works

1. Split note into sentences (claims)
2. Classify each (fact, inference, opinion, etc)
3. Match against transcript chunks
4. Score based on token overlap + number coverage

## exports

- `verifyNote(note, transcript, opts?)` - main api
- `tokenize`, `extractNumbers`, `calculateOverlap`, `classifyClaim` - utils

## run tests

```bash
npx tsx --test packages/pipeline/verification/src/__tests__/*.test.ts
```
