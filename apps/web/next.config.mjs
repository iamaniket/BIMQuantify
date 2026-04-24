/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@bim-quantify/ui',
    '@bim-quantify/ifc-parser',
    '@bim-quantify/bcf-parser',
    '@bim-quantify/ai-takeoff',
  ],
};

export default nextConfig;
