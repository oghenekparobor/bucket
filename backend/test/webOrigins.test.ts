// The CORS allow-list is typed into a dashboard by hand. The first Railway deploy failed on it
// twice: once unset, once set on a backend service that was then replaced. These pin the shapes
// that must still work, so a pasted URL with a trailing slash cannot silently match nothing.
import { describe, expect, it } from 'vitest';
import { webOrigins } from '../src/config.js';

describe('webOrigins', () => {
  it('drops the trailing slash an address bar adds', () => {
    expect(webOrigins({ WEB_ORIGIN: 'https://app.example.com/' })).toEqual(['https://app.example.com']);
  });

  it('accepts a comma-separated list with stray spaces and empties', () => {
    expect(webOrigins({ WEB_ORIGIN: ' https://a.example.com , https://b.example.com/ ,, ' })).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('leaves a clean origin alone', () => {
    expect(webOrigins({ WEB_ORIGIN: 'http://localhost:3000' })).toEqual(['http://localhost:3000']);
  });
});
