// Runner dos testes unitários: um processo por arquivo.
//
// `mock.module` do Bun é global e não tem como desfazer: um arquivo que mocka
// `caixinha.service` continua servindo o stub pros arquivos que rodarem depois
// dele — o `caixinha.service.test.ts` acaba testando o mock do vizinho em vez
// do módulo real. Como a ordem dos arquivos vem do walk do runner (muda entre
// máquinas e versões do Bun), isso passa localmente e quebra no CI.
//
// Rodar cada arquivo isolado remove a classe inteira de problema. Argumentos
// extras (-t, --coverage…) são repassados pro `bun test` de cada arquivo.
import { Glob } from "bun";
import { rm, readdir, readFile } from "node:fs/promises";

const passthrough = process.argv.slice(2);
const comCoverage = passthrough.includes("--coverage");
const args = passthrough.filter((a) => a !== "--coverage");

const COVERAGE_DIR = "coverage/unit";

const arquivos = (await Array.fromAsync(new Glob("server/**/*.test.ts").scan("."))).sort();
if (arquivos.length === 0) {
  console.error("Nenhum teste unitário encontrado em server/.");
  process.exit(1);
}

if (comCoverage) await rm(COVERAGE_DIR, { recursive: true, force: true });

const falhas: string[] = [];

for (const [i, arquivo] of arquivos.entries()) {
  const cobertura = comCoverage
    ? ["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${COVERAGE_DIR}/${i}`]
    : [];
  const { exitCode } = Bun.spawnSync({
    cmd: [process.execPath, "test", arquivo, ...cobertura, ...args],
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (exitCode !== 0) falhas.push(arquivo);
}

if (comCoverage) await relatorioCobertura();

console.log(
  falhas.length === 0
    ? `\n✓ ${arquivos.length} arquivos de teste unitário, todos passando (processos isolados).`
    : `\n✗ ${falhas.length}/${arquivos.length} arquivos falharam:\n${falhas.map((f) => `  - ${f}`).join("\n")}`
);

process.exit(falhas.length === 0 ? 0 : 1);

// ── Cobertura ───────────────────────────────────────────────────────────────
// Cada processo escreve o lcov só do que ele carregou; aqui os relatórios são
// somados por arquivo-fonte pra virar o total da suíte.
type Fonte = { linhas: Map<number, number>; funcs: Map<string, number> };

async function relatorioCobertura() {
  const fontes = new Map<string, Fonte>();

  for (const dir of await readdir(COVERAGE_DIR)) {
    const lcov = await readFile(`${COVERAGE_DIR}/${dir}/lcov.info`, "utf8").catch(() => null);
    if (!lcov) continue;

    let atual: Fonte | null = null;
    for (const linha of lcov.split("\n")) {
      const [tag, valor] = [linha.slice(0, linha.indexOf(":")), linha.slice(linha.indexOf(":") + 1)];
      if (tag === "SF") {
        const arquivo = valor.replace(`${process.cwd()}/`, "");
        atual = fontes.get(arquivo) ?? { linhas: new Map(), funcs: new Map() };
        fontes.set(arquivo, atual);
      } else if (tag === "DA" && atual) {
        const [n, hits] = valor.split(",").map(Number);
        atual.linhas.set(n, (atual.linhas.get(n) ?? 0) + hits);
      } else if (tag === "FNDA" && atual) {
        const virgula = valor.indexOf(",");
        const [hits, nome] = [Number(valor.slice(0, virgula)), valor.slice(virgula + 1)];
        atual.funcs.set(nome, (atual.funcs.get(nome) ?? 0) + hits);
      } else if (tag === "FN" && atual) {
        const nome = valor.slice(valor.indexOf(",") + 1);
        if (!atual.funcs.has(nome)) atual.funcs.set(nome, 0);
      }
    }
  }

  const pct = (cobertos: number, total: number) => (total === 0 ? 100 : (cobertos / total) * 100);
  const linhaDoRelatorio = (arquivo: string, f: Fonte) => ({
    arquivo,
    funcs: pct([...f.funcs.values()].filter((h) => h > 0).length, f.funcs.size),
    linhas: pct([...f.linhas.values()].filter((h) => h > 0).length, f.linhas.size),
  });

  const linhas = [...fontes]
    .filter(([arquivo]) => !arquivo.includes(".test.") && arquivo.startsWith("server/"))
    .map(([arquivo, f]) => linhaDoRelatorio(arquivo, f))
    .sort((a, b) => a.arquivo.localeCompare(b.arquivo));

  const total = [...fontes.values()].reduce(
    (acc, f) => {
      for (const h of f.funcs.values()) acc.funcsTotal++, h > 0 && acc.funcsHit++;
      for (const h of f.linhas.values()) acc.linhasTotal++, h > 0 && acc.linhasHit++;
      return acc;
    },
    { funcsHit: 0, funcsTotal: 0, linhasHit: 0, linhasTotal: 0 }
  );

  const larg = Math.max(20, ...linhas.map((l) => l.arquivo.length));
  const sep = "-".repeat(larg) + "|---------|---------";
  const fmt = (n: number) => n.toFixed(2).padStart(7);

  console.log(`\n${"Arquivo".padEnd(larg)}| % Funcs | % Lines`);
  console.log(sep);
  console.log(
    `${"Todos os arquivos".padEnd(larg)}|${fmt(pct(total.funcsHit, total.funcsTotal))} |${fmt(pct(total.linhasHit, total.linhasTotal))}`
  );
  console.log(sep);
  for (const l of linhas) console.log(`${l.arquivo.padEnd(larg)}|${fmt(l.funcs)} |${fmt(l.linhas)}`);
  console.log(sep);
}
