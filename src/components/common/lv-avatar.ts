import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';

/**
 * Avatar component that displays a Gravatar image with fallback to initials.
 *
 * Usage:
 *   <lv-avatar email="user@example.com" name="John Doe" size="32"></lv-avatar>
 *   <lv-avatar email="user@example.com"></lv-avatar>
 *   <lv-avatar src="https://..." name="Custom"></lv-avatar>
 */
@customElement('lv-avatar')
export class LvAvatar extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: inline-block;
        vertical-align: middle;
      }

      .avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        overflow: hidden;
        flex-shrink: 0;
        user-select: none;
      }

      .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .avatar .initials {
        color: #fff;
        font-weight: var(--font-weight-medium, 500);
        text-transform: uppercase;
        line-height: 1;
        letter-spacing: 0.02em;
      }
    `,
  ];

  /** Email address used to generate Gravatar URL and fallback color */
  @property({ type: String }) email = '';

  /** Display name, used for generating initials if provided */
  @property({ type: String }) name = '';

  /** Size in pixels */
  @property({ type: Number }) size = 32;

  /** Optional explicit image source (overrides Gravatar) */
  @property({ type: String }) src = '';

  @state() private _imageError = false;

  private get _gravatarUrl(): string {
    if (!this.email) return '';
    const normalized = this.email.trim().toLowerCase();
    const hash = LvAvatar._md5(normalized);
    // Request 2x size for retina displays
    const requestSize = this.size * 2;
    return `https://www.gravatar.com/avatar/${hash}?s=${requestSize}&d=404`;
  }

  private get _imageSrc(): string {
    if (this.src) return this.src;
    if (!this._imageError && this.email) return this._gravatarUrl;
    return '';
  }

  private get _initials(): string {
    // Prefer deriving initials from name if available
    if (this.name) {
      const parts = this.name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return this.name.trim().substring(0, 2).toUpperCase();
    }

    // Fall back to email
    if (this.email) {
      const local = this.email.split('@')[0] || '';
      const segments = local.split(/[._-]/);
      if (segments.length >= 2) {
        return (segments[0][0] + segments[1][0]).toUpperCase();
      }
      return local.substring(0, 2).toUpperCase();
    }

    return '?';
  }

  private get _backgroundColor(): string {
    const source = this.email || this.name || '';
    if (!source) return '#6b7280'; // neutral gray
    const hash = LvAvatar._simpleHash(source.trim().toLowerCase());
    return LvAvatar._hashToColor(hash);
  }

  render() {
    const sizeStyle = `width: ${this.size}px; height: ${this.size}px;`;
    const fontSize = `font-size: ${Math.max(10, Math.round(this.size * 0.4))}px;`;
    const imgSrc = this._imageSrc;

    return html`
      <div
        class="avatar"
        style="${sizeStyle} background-color: ${this._backgroundColor};"
        title=${this.name || this.email}
        role="img"
        aria-label=${this.name || this.email || 'User avatar'}
      >
        ${imgSrc
          ? html`<img
              src=${imgSrc}
              alt=${this.name || this.email}
              @error=${this._onImageError}
              loading="lazy"
            />`
          : html`<span class="initials" style="${fontSize}">${this._initials}</span>`}
      </div>
    `;
  }

  private _onImageError() {
    this._imageError = true;
  }

  updated(changedProperties: Map<string, unknown>) {
    // Reset image error state when email or src changes
    if (changedProperties.has('email') || changedProperties.has('src')) {
      this._imageError = false;
    }
  }

  /**
   * Simple string hash (DJB2 variant) for consistent color generation.
   */
  static _simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /**
   * Convert a numeric hash to a pleasant HSL color string.
   * Uses constrained saturation and lightness for good contrast with white text.
   */
  static _hashToColor(hash: number): string {
    const hue = hash % 360;
    const saturation = 45 + (hash % 25); // 45-70%
    const lightness = 35 + (hash % 15);  // 35-50%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  /**
   * Minimal MD5 implementation for Gravatar URL generation.
   * This is not used for security purposes -- only for constructing the
   * standard Gravatar hash from an email address.
   */
  static _md5(input: string): string {
    const S: number[] = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];

    const K: number[] = [
      0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
      0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
      0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
      0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
      0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
      0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
      0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
      0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
      0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
      0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
      0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
      0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
      0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
      0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
      0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
      0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
    ];

    // Convert string to UTF-8 byte array
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }

    const origLenBits = bytes.length * 8;

    // Padding
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
      bytes.push(0);
    }

    // Append length as 64-bit little-endian
    for (let i = 0; i < 8; i++) {
      bytes.push((origLenBits >>> (i * 8)) & 0xff);
    }

    // Helper: 32-bit left rotate
    const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < bytes.length; offset += 64) {
      const m: number[] = new Array(16);
      for (let j = 0; j < 16; j++) {
        const idx = offset + j * 4;
        m[j] = bytes[idx] | (bytes[idx + 1] << 8) | (bytes[idx + 2] << 16) | (bytes[idx + 3] << 24);
      }

      let a = a0, b = b0, c = c0, d = d0;

      for (let i = 0; i < 64; i++) {
        let f: number, g: number;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }

        f = (f + a + K[i] + m[g]) | 0;
        a = d;
        d = c;
        c = b;
        b = (b + rotl(f, S[i])) | 0;
      }

      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    // Convert to hex (little-endian bytes)
    const toHex = (n: number) => {
      let hex = '';
      for (let i = 0; i < 4; i++) {
        const byte = (n >>> (i * 8)) & 0xff;
        hex += byte.toString(16).padStart(2, '0');
      }
      return hex;
    };

    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-avatar': LvAvatar;
  }
}
