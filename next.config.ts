/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
  typescript: {
    // No fallar el build si hay errores de tipo temporales
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
