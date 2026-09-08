import { useRef, useState } from "react";

// Seleção de linhas de uma lista, com faixa por Shift+clique.
//
//   const sel = useSelecao(ids, `${ym}:${espacoId}`);
//
// `ids` é a ordem visível (a faixa do Shift é a visível, não a do banco).
// `chave` reseta a seleção quando muda — sem isso uma ação em lote sairia com
// ids de outro mês/espaço.
export function useSelecao(ids, chave) {
  const [sel, setSel] = useState(() => new Set());
  const [vistoChave, setVistoChave] = useState(chave);
  const ancora = useRef(null);

  if (vistoChave !== chave) {
    setVistoChave(chave);
    if (sel.size > 0) setSel(new Set());
    // âncora não precisa de reset: o id antigo sai de `ids` e o Shift+clique
    // cai no toggle simples (indexOf === -1).
  }

  // Linha excluída/filtrada fora não pode continuar contando no total.
  const selecionados = ids.filter((id) => sel.has(id));
  const todos = ids.length > 0 && selecionados.length === ids.length;
  const parcial = selecionados.length > 0 && !todos;

  function toggle(id, shift = false) {
    setSel((atual) => {
      const next = new Set(atual);
      const de = ancora.current != null ? ids.indexOf(ancora.current) : -1;
      const ate = ids.indexOf(id);
      if (shift && de >= 0 && ate >= 0) {
        // faixa: liga tudo entre a âncora e o clique (o estado do clique manda)
        const ligar = !atual.has(id);
        for (let i = Math.min(de, ate); i <= Math.max(de, ate); i++) {
          if (ligar) next.add(ids[i]);
          else next.delete(ids[i]);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      ancora.current = id;
      return next;
    });
  }

  function toggleTodos() {
    setSel(todos ? new Set() : new Set(ids));
    ancora.current = null;
  }

  function limpar() {
    setSel(new Set());
    ancora.current = null;
  }

  return {
    ids: selecionados,
    tem: (id) => sel.has(id),
    quantos: selecionados.length,
    todos,
    // o checkbox do cabeçalho fica em traço quando a seleção é parcial
    estadoTodos: parcial ? "indeterminate" : todos,
    toggle,
    toggleTodos,
    limpar,
  };
}
