"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

// Tema é 100% client-side: o valor mora no localStorage, não existe no
// servidor, e nada no RSC depende da cor — por isso não vira cookie. Quem
// aplica antes da primeira pintura é o script inline do `app/layout.tsx`;
// aqui só trocamos o atributo e persistimos.
//
// A fonte da verdade é o próprio `<html data-tema>`, não um useState: o
// script inline já escreveu nele antes do React existir, e duplicar isso em
// estado abriria divergência (hidratação com um valor, DOM com outro).
export const CHAVE_TEMA = "wallet:tema";

const ouvintes = new Set();

export function aplicaTema(tema) {
  document.documentElement.dataset.tema = tema;
  ouvintes.forEach((cb) => cb());
}

function assina(cb) {
  ouvintes.add(cb);
  return () => ouvintes.delete(cb);
}

function noCliente() {
  return document.documentElement.dataset.tema === "claro" ? "claro" : "escuro";
}

// O HTML do servidor não carrega tema (o script inline roda depois dele), então
// o snapshot do servidor é o padrão; o React re-renderiza com o valor real logo
// após a hidratação, sem avisar divergência.
const noServidor = () => "escuro";

export function useTema() {
  const tema = useSyncExternalStore(assina, noCliente, noServidor);

  function troca() {
    const novo = tema === "claro" ? "escuro" : "claro";
    aplicaTema(novo);
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      // modo privado / storage bloqueado: o tema vale só nesta aba
    }
  }

  return [tema, troca];
}

/** @param {{ className?: string }} props */
export function BotaoTema({ className }) {
  const [tema, troca] = useTema();
  const claro = tema === "claro";
  const rotulo = claro ? "Mudar para o tema escuro" : "Mudar para o tema claro";
  return (
    <button
      type="button"
      onClick={troca}
      title={rotulo}
      aria-label={rotulo}
      className={[
        "relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors cursor-pointer hover:bg-veu/[0.08] hover:text-ink before:absolute before:-inset-1 before:content-['']",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {claro ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
