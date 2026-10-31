import type { NextConfig } from 'next'

// Phase 5 security headers. Dev needs eval + websockets for HMR, so the CSP
// relaxes two directives there; production stays tight.
const isDev = process.env.NODE_ENV !== 'production'

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // Tailwind and Next ship styles as inline <style> blocks.
  "style-src 'self' 'unsafe-inline'",
  // next/font self-hosts fonts; data: covers inlined font/style payloads.
  "font-src 'self' data:",
  "img-src 'self' blob: data:",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Dev-only: allow opening the dev server on these hosts. Without this, Next
  // blocks its dev resources (HMR client) when the origin isn't `localhost`.
  allowedDevOrigins: ['127.0.0.1', '192.168.100.14'],
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          // Ignored over plain http (including localhost dev); applies once
          // the app is served over https.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ]
  },
}

export default nextConfig
