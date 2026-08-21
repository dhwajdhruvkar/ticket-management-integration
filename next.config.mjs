/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Standalone output for a minimal production Docker image.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Server-only packages must never be bundled into client/edge output.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "bullmq", "ioredis", "pdfkit"],
  // pdfkit reads its built-in AFM font metrics from disk at runtime; make sure
  // the standalone build traces those data files for the PDF report endpoint.
  outputFileTracingIncludes: {
    "/api/v1/reports": ["./node_modules/pdfkit/js/data/**/*"],
  },
};

export default nextConfig;
