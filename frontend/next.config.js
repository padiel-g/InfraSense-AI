const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const apiHost = new URL(apiUrl)

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '8000' },
      {
        protocol: apiHost.protocol.replace(':', ''),
        hostname: apiHost.hostname,
        port: apiHost.port,
      },
    ],
  },
}
module.exports = nextConfig
