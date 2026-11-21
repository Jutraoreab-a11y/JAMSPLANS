/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // JAMAL PERMIS et Langue sont des pages statiques (public/*.html) servies sur /permis et /langue.
  async rewrites() {
    return [
      { source: "/permis", destination: "/permis.html" },
      { source: "/langue", destination: "/langue.html" },
    ];
  },
};

module.exports = nextConfig;
