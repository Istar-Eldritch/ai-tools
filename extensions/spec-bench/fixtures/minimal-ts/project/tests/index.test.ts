import { greet } from '../src/index.js';

describe('greet', () => {
  it('returns greeting with name', () => {
    expect(greet('World')).toBe('Hello, World!');
  });

  it('handles empty name', () => {
    expect(greet('')).toBe('Hello, !');
  });
});
