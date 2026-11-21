/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // JAMAL PERMIS est une page statique (public/permis.html) servie sur /permis.
  async rewrites() {
    return [{ source: "/permis", destination: "/permis.html" }];
  },
};

module.exports = nextConfig;
