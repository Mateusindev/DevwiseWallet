// Preload SÓ da suíte de front (`bun run test:front`), não do bunfig global:
// registrar document/window pros testes de back não traria nada e mudaria o
// ambiente deles de graça.
//
// Ordem importa: GlobalRegistrator.register() tem que rodar ANTES de qualquer
// import de React ou de componente — por isso isto é um --preload, não um
// beforeAll. A `url` explícita é o que faz `hc<AppType>('/')` resolver os
// caminhos relativos (/api/...) sem quebrar o fetch.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, expect } from "bun:test";

// A pilha de fetch do happy-dom DESCARTA Set-Cookie da resposta (ela simula um
// navegador, onde o cookie vai pro jar interno e some do header). A ponte de
// tests/front/harness.tsx precisa ler o Set-Cookie do app Hono pra manter a
// sessão httpOnly, então o Response/Headers/Request/fetch nativos do Bun são
// restaurados logo depois do register. O DOM (document/window) fica intacto.
const nativos = {
  fetch: globalThis.fetch,
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  Response: globalThis.Response,
  FormData: globalThis.FormData,
  Blob: globalThis.Blob,
};

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, nativos);

// React 19 só considera o ambiente "de teste" (e silencia o aviso de act())
// com este flag global.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Imports depois do register: os dois puxam DOM na carga do módulo.
const [matchers, { cleanup }] = await Promise.all([
  import("@testing-library/jest-dom/matchers"),
  import("@testing-library/react"),
]);

// O pacote exporta os matchers como named exports (e um default em CJS) —
// pegar os dois cobre as duas formas de resolução.
const { default: _default, ...named } = matchers as Record<string, unknown>;
expect.extend({ ...(_default as object), ...named } as Parameters<typeof expect.extend>[0]);

// A Testing Library só auto-limpa dentro de jest/vitest; no runner do Bun é
// manual, senão a árvore do teste anterior continua no document.
afterEach(cleanup);

// Rejeição sem catch em qualquer lugar do app derruba a suíte: o runner do Bun
// reporta "Unhandled error between tests" e sai com código 1 mesmo com 0 testes
// falhando. Foi assim que os efeitos fire-and-forget do Dashboard/Cartoes
// (reloadCartoes, getOrcamento) apareceram — hoje têm `.catch`.
