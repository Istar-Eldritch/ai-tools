# Feature: String Reverse Utility

Implement a string utility module with the following function:

## Requirements

1. Create a function `reverseString(input: string): string` that:
   - Reverses the characters in a string
   - Handles empty strings (returns empty string)
   - Preserves Unicode characters correctly

2. Export the function from `src/utils.ts`

3. The function should be pure (no side effects)

## Example Usage

```typescript
import { reverseString } from './utils';

reverseString('hello'); // Returns 'olleh'
reverseString(''); // Returns ''
reverseString('🎉🎊'); // Returns '🎊🎉'
```

## Acceptance Criteria

- All existing tests continue to pass
- The new function is properly typed
- The function handles edge cases gracefully
