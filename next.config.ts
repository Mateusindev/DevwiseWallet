import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // O default é 1MB. O import de OFX (o único payload realmente grande)
      // continua num Route Handler de propósito — ver 4.4 do plano —, mas as
      // ações em lote mandam listas de ids e a margem sai barata.
      bodySizeLimit: "2mb",
      // Descomentar quando houver proxy/CDN na frente: o CSRF das actions
      // compara `Origin` com `Host`/`X-Forwarded-Host`.
      // allowedOrigins: ["exemplo.com", "*.exemplo.com"],
    },
  },
};

export default nextConfig;
