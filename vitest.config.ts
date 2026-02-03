import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['extensions/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/fixtures/**',  // Exclude fixture sample test files (they're test data, not real tests)
    ],
  },
})
