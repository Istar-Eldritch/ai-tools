import { placeholder } from '../src/lib.js';

describe('placeholder', () => {
  it('returns placeholder string', () => {
    expect(placeholder()).toBe('This will be replaced by the Calculator class');
  });
});
