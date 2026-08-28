/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/tesseract/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};
