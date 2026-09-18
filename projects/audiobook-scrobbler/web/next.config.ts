import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Independent project inside a monorepo with its own lockfile.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
