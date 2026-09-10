import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Cache de cliente dos segmentos de página. O default de `dynamic` é 0s —
    // como o layout lê cookie, TODA rota do app é dinâmica, e voltar pra uma aba
    // já visitada refazia o round-trip do segmento. As páginas aqui são finas
    // (os dados vivem no provider do layout), então guardá-las por alguns
    // minutos deixa a navegação instantânea sem risco de mostrar dado velho.
    staleTimes: { dynamic: 180, static: 300 },
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
