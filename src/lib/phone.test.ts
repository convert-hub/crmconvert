import { describe, it, expect } from 'vitest';
import { normalizeBrazilPhone } from './phone';

describe('normalizeBrazilPhone', () => {
  const cases: Array<[unknown, string]> = [
    ['+55 (31) 98017-5217', '5531980175217'],
    ['+5531980175217', '5531980175217'],
    ['5531980175217', '5531980175217'],
    ['553180175217', '5531980175217'], // Meta sem o 9 — bug real
    ['31980175217', '5531980175217'],
    ['3180175217', '5531980175217'],
    ['+1 415 555 0100', '14155550100'],
    ['+55 11 3456-7890', '551134567890'], // fixo BR, não inserir 9
    ['', ''],
    [null, ''],
    ['abc', ''],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(normalizeBrazilPhone(input)).toBe(expected);
    });
  }

  it('é idempotente', () => {
    const samples = ['+5531980175217', '553180175217', '31980175217', '+1 415 555 0100'];
    for (const s of samples) {
      const once = normalizeBrazilPhone(s);
      expect(normalizeBrazilPhone(once)).toBe(once);
    }
  });
});
