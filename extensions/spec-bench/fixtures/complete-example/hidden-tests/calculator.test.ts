/**
 * Hidden tests for Calculator class
 * These tests are copied after implementation to verify correctness
 */

import Calculator from '../src/calculator.js';

describe('Calculator hidden tests', () => {
  let calc: Calculator;

  beforeEach(() => {
    calc = new Calculator();
  });

  describe('add', () => {
    it('adds negative numbers', () => {
      expect(calc.add(-5, -3)).toBe(-8);
    });

    it('adds decimal numbers', () => {
      expect(calc.add(0.1, 0.2)).toBeCloseTo(0.3);
    });
  });

  describe('subtract', () => {
    it('subtracts resulting in negative', () => {
      expect(calc.subtract(3, 10)).toBe(-7);
    });
  });

  describe('multiply', () => {
    it('multiplies by zero', () => {
      expect(calc.multiply(100, 0)).toBe(0);
    });

    it('multiplies negative numbers', () => {
      expect(calc.multiply(-4, -5)).toBe(20);
    });
  });

  describe('divide', () => {
    it('throws on division by zero', () => {
      expect(() => calc.divide(10, 0)).toThrow('Division by zero');
    });

    it('handles negative division', () => {
      expect(calc.divide(-10, 2)).toBe(-5);
    });

    it('handles decimal results', () => {
      expect(calc.divide(10, 4)).toBe(2.5);
    });
  });
});
