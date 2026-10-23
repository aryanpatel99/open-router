import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  // Transpile @repo/db so Turbopack handles the Prisma 7 TypeScript-first
  // generated client and resolves .js → .ts (NodeNext ESM convention).
  transpilePackages: ["@repo/db"],

  // Keep the native Prisma/Neon packages as Node.js externals so Turbopack
  // doesn't try to bundle them (they use Node-only APIs: net, tls, crypto).
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon"],

  // Built with webpack (see package.json scripts): Turbopack can't resolve
  // @repo/db's NodeNext-style `./client.js` imports to their .ts sources.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },

  // Pin the monorepo root so Next doesn't pick /Users/aryanpatel/package-lock.json.
  outputFileTracingRoot: resolve(process.cwd(), "../../"),
};

export default nextConfig;
