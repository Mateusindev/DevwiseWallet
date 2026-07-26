// Os matchers do jest-dom entram em runtime via expect.extend (tests/setup/dom.ts);
// o TypeScript precisa deles declarados à parte, senão `toBeInTheDocument` não
// existe no tipo Matchers do bun:test e o typecheck reprova a suíte de front.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

/* eslint-disable @typescript-eslint/no-empty-object-type -- augmentation de
   módulo: as interfaces existem só pra herdar os matchers do jest-dom. */
declare module "bun:test" {
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<unknown, void> {}
}
