import WebpackObfuscator from "webpack-obfuscator";

/**
 * Source protection:
 *  - productionBrowserSourceMaps: false → no .map files are shipped
 *  - SWC minification (default) mangles every client chunk
 *  - route-level app chunks are additionally obfuscated (string arrays, hex identifiers)
 *  - all scraping / auth / billing logic is server-only (guarded with `import "server-only"`)
 */
const OBFUSCATE = process.env.OBFUSCATE !== "0";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { instrumentationHook: true, serverComponentsExternalPackages: ["undici", "nodemailer", "firebase-admin", "puppeteer-core", "@sparticuz/chromium", "puppeteer-extra", "puppeteer-extra-plugin-stealth"] },
  productionBrowserSourceMaps: false,
  compress: true,
  images: { unoptimized: true },
  webpack(config, { isServer, dev }) {
    if (!isServer && !dev && OBFUSCATE) {
      config.plugins.push(
        new WebpackObfuscator(
          {
            compact: true,
            identifierNamesGenerator: "hexadecimal",
            stringArray: true,
            stringArrayEncoding: ["base64"],
            stringArrayThreshold: 0.75,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            splitStrings: true,
            splitStringsChunkLength: 8,
            numbersToExpressions: true,
            simplify: true,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            selfDefending: false,
            renameGlobals: false,
            transformObjectKeys: false,
            unicodeEscapeSequence: false,
            sourceMap: false,
          },
          // Obfuscate only our route chunks; leave React/Next framework chunks untouched.
          ["**", "!static/chunks/app/**"],
        ),
      );
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};
export default nextConfig;
