import { describe, expect, it } from 'vitest';
import { maskApiKey } from '../../src/core/secrets';

/** 长度为 n 的 key，每个字符都不同，便于判断泄露了哪些字符。 */
function keyOfLength(n: number, prefix = ''): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let body = '';
  for (let i = 0; body.length < n - prefix.length; i++) {
    body += alphabet[i % alphabet.length] + String(Math.floor(i / alphabet.length));
  }
  return prefix + body.slice(0, n - prefix.length);
}

describe('API key 掩码', () => {
  it('常见格式显示为前缀、省略号和末尾 4 位', () => {
    expect(maskApiKey('sk-test-0000000000000000abcd')).toBe('sk-…abcd');
    expect(maskApiKey('0123456789abcdefWXYZ')).toBe('…WXYZ');
  });

  it.each([1, 4, 8, 12, 15])('长度 %i 的短 key 不显示任何字符', (n) => {
    expect(maskApiKey(keyOfLength(n))).toBe('…');
  });

  for (const prefix of ['', 'sk-', 'sk-proj-']) {
    for (const n of [16, 17, 20, 32, 51, 64, 164]) {
      it(`前缀 "${prefix}"、长度 ${n}：中间部分不出现在掩码中`, () => {
        const key = keyOfLength(n, prefix);
        const mask = maskApiKey(key);
        // 掩码中不出现 key 的任何 5 个连续字符
        for (let i = 0; i + 5 <= key.length; i++) {
          expect(mask).not.toContain(key.slice(i, i + 5));
        }
        // 至少隐藏了 key 的一半
        expect(mask.replace('…', '').length).toBeLessThanOrEqual(key.length / 2);
      });
    }
  }
});
