import { expect } from '@open-wc/testing';
import { md5 } from '../md5.ts';

describe('md5', () => {
  it('should produce correct hash for empty string', () => {
    expect(md5('')).to.equal('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('should produce correct hash for "a"', () => {
    expect(md5('a')).to.equal('0cc175b9c0f1b6a831c399e269772661');
  });

  it('should produce correct hash for "abc"', () => {
    expect(md5('abc')).to.equal('900150983cd24fb0d6963f7d28e17f72');
  });

  it('should produce correct hash for "message digest"', () => {
    expect(md5('message digest')).to.equal('f96b697d7cb7938d525a2f31aaf161d0');
  });

  it('should produce correct hash for alphabetic string', () => {
    expect(md5('abcdefghijklmnopqrstuvwxyz')).to.equal('c3fcd3d76192e4007dfb496cca67e13b');
  });

  it('should produce consistent results for same input', () => {
    const hash1 = md5('test@example.com');
    const hash2 = md5('test@example.com');
    expect(hash1).to.equal(hash2);
  });

  it('should produce different results for different inputs', () => {
    const hash1 = md5('hello');
    const hash2 = md5('world');
    expect(hash1).to.not.equal(hash2);
  });

  it('should produce a 32-character hex string', () => {
    const hash = md5('test');
    expect(hash).to.have.lengthOf(32);
    expect(hash).to.match(/^[0-9a-f]+$/);
  });

  it('should handle unicode input', () => {
    const hash = md5('héllo wörld');
    expect(hash).to.have.lengthOf(32);
    expect(hash).to.match(/^[0-9a-f]+$/);
  });

  it('should handle long strings', () => {
    const hash = md5('a'.repeat(1000));
    expect(hash).to.have.lengthOf(32);
    expect(hash).to.match(/^[0-9a-f]+$/);
  });
});
