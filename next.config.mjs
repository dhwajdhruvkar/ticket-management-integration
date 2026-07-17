/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  // Standalone output for a minimal production Docker image.
  output: "standalone",
  // ESLint is optional for this project; TypeScript still type-checks the build.
  eslint: {
    ignoreDuringBuilds: true,
  },
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
  // Transformers.js runs client-side only; stub out its optional Node-only deps
  // so webpack doesn't try to bundle them.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node$": false,
      sharp$: false,
    };
    return config;
  },
};

export default nextConfig;
