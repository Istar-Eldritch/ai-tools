# Feature: Calculator Module

Implement a calculator module with basic arithmetic operations.

## Requirements

1. Create a `Calculator` class in `src/calculator.ts` with the following methods:
   - `add(a: number, b: number): number` - Addition
   - `subtract(a: number, b: number): number` - Subtraction
   - `multiply(a: number, b: number): number` - Multiplication
   - `divide(a: number, b: number): number` - Division

2. Division by zero should throw an `Error` with message "Division by zero"

3. All methods should handle:
   - Positive and negative numbers
   - Decimal numbers
   - Zero values

4. Export the `Calculator` class as the default export

## Example Usage

```typescript
import Calculator from './calculator';

const calc = new Calculator();
calc.add(2, 3);      // Returns 5
calc.subtract(5, 3); // Returns 2
calc.multiply(4, 3); // Returns 12
calc.divide(10, 2);  // Returns 5
calc.divide(1, 0);   // Throws Error: Division by zero
```

## Acceptance Criteria

- All existing tests pass
- New Calculator class is properly typed
- Division by zero is handled correctly
- Edge cases (negative numbers, decimals) work correctly
