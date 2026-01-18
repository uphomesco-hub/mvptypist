/** @type {import('next').NextConfig} */
const isGithubPages = process.env.GITHUB_PAGES === "true";
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const resolvedBasePath = basePath || undefined;

const nextConfig = {
  reactStrictMode: true,
  output: isGithubPages ? "export" : undefined,
  trailingSlash: isGithubPages,
  basePath: resolvedBasePath,
  assetPrefix: resolvedBasePath,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
