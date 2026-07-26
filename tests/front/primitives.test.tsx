// Primitivos de UI (components/ui/primitives.jsx). Únicos testes de front que
// não sobem banco nem app: renderizam o componente direto.
import { describe, expect, it, mock } from "bun:test";
import { render, screen, userEvent, within } from "./harness";
import { useState, type ComponentType } from "react";
// primitives é .jsx sem tipos: o TS infere TODA prop como obrigatória (mesmo
// motivo do cast em components/Admin.tsx).
import * as P from "@/components/ui/primitives.jsx";
const { Button, Field, Modal, MoneyInput, PercentInput, ProgressBar, Badge, Card } =
  P as unknown as Record<string, ComponentType<Record<string, unknown>>>;

describe("Modal", () => {
  const Abrir = ({ onClose = () => {} }: { onClose?: () => void }) => (
    <Modal open onClose={onClose} title="Título do modal">
      <p>conteúdo</p>
      <input placeholder="campo" />
    </Modal>
  );

  it("renderiza num portal, com role/aria e foco no dialog", async () => {
    const { container } = render(<Abrir />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Título do modal");
    // portal: fora do container do render
    expect(container.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(dialog);
  });

  it("Esc chama onClose", async () => {
    const onClose = mock(() => {});
    const u = userEvent.setup();
    render(<Abrir onClose={onClose} />);

    await u.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clique no backdrop chama onClose", async () => {
    const onClose = mock(() => {});
    const u = userEvent.setup();
    render(<Abrir onClose={onClose} />);

    const backdrop = document.querySelector<HTMLElement>('[aria-hidden].absolute')!;
    await u.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("trava o scroll do body enquanto aberto e restaura no unmount", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(<Abrir />);

    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("fechado não renderiza nada", () => {
    render(
      <Modal open={false} onClose={() => {}} title="X">
        <p>conteúdo</p>
      </Modal>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("NÃO rouba o foco a cada keystroke do pai (regressão do onCloseRef)", async () => {
    // pai que re-renderiza a cada tecla e passa um onClose novo toda vez
    function Pai() {
      const [texto, setTexto] = useState("");
      return (
        <Modal open onClose={() => setTexto("")} title="Digitável">
          <input placeholder="campo" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Modal>
      );
    }
    const u = userEvent.setup();
    render(<Pai />);

    const input = screen.getByPlaceholderText("campo");
    await u.click(input);
    await u.type(input, "abc");

    expect((input as HTMLInputElement).value).toBe("abc");
    expect(document.activeElement).toBe(input); // o efeito não re-rodou
  });
});

describe("MoneyInput", () => {
  function Campo({ inicial = 0 }: { inicial?: number }) {
    const [v, setV] = useState(inicial);
    return (
      <>
        <MoneyInput value={v} onValue={setV} />
        <output>{v}</output>
      </>
    );
  }

  it("máscara: dígitos crus divididos por 100", async () => {
    const u = userEvent.setup();
    render(<Campo />);
    const input = screen.getByRole("textbox");

    await u.type(input, "123450");
    expect((input as HTMLInputElement).value).toBe("1.234,50");
    expect(screen.getByText("1234.5")).toBeInTheDocument();
  });

  it("descarta não-dígitos", async () => {
    const u = userEvent.setup();
    render(<Campo />);
    const input = screen.getByRole("textbox");

    await u.type(input, "a1b2c3");
    expect((input as HTMLInputElement).value).toBe("1,23");
  });

  it("valor 0 mostra vazio (deixa o placeholder aparecer)", () => {
    render(<Campo />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByPlaceholderText("0,00")).toBeInTheDocument();
  });

  it("backspace desloca as casas (é máscara de dígitos, não texto livre)", async () => {
    const u = userEvent.setup();
    render(<Campo inicial={12.34} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("12,34");

    await u.type(input, "{backspace}"); // dígitos "1234" → "123"
    expect(input.value).toBe("1,23");
  });

  it("limpar o campo volta pra 0", async () => {
    const u = userEvent.setup();
    render(<Campo inicial={12.34} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    await u.clear(input);
    expect(input.value).toBe("");
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

describe("PercentInput", () => {
  it("mesma máscara, com sufixo % a.a.", async () => {
    function Campo() {
      const [v, setV] = useState(0);
      return (
        <>
          <PercentInput value={v} onValue={setV} />
          <output>{v}</output>
        </>
      );
    }
    const u = userEvent.setup();
    render(<Campo />);

    await u.type(screen.getByRole("textbox"), "1250");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("12,50");
    expect(screen.getByText("% a.a.")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("loading desabilita e mostra o spinner", () => {
    render(<Button loading>Salvar</Button>);
    const botao = screen.getByRole("button");

    expect(botao).toBeDisabled();
    expect(botao.querySelector(".animate-spin")).not.toBeNull();
  });

  it("disabled não dispara onClick", async () => {
    const onClick = mock(() => {});
    const u = userEvent.setup();
    render(<Button disabled onClick={onClick}>Salvar</Button>);

    await u.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("variante desconhecida não quebra o render", () => {
    render(<Button variant="growth">Aporte</Button>);
    expect(screen.getByRole("button", { name: "Aporte" })).toBeInTheDocument();
  });
});

describe("ProgressBar", () => {
  it("clampa 0..1 e expõe aria-valuenow em %", () => {
    const { rerender } = render(<ProgressBar value={0.25} />);
    const barra = screen.getByRole("progressbar");
    expect(barra).toHaveAttribute("aria-valuenow", "25");
    expect(barra).toHaveAttribute("aria-valuemin", "0");
    expect(barra).toHaveAttribute("aria-valuemax", "100");

    rerender(<ProgressBar value={5} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    rerender(<ProgressBar value={-3} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("sem valor assume 0", () => {
    render(<ProgressBar />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("Field", () => {
  it("erro vira role=alert e esconde o hint", () => {
    const { rerender } = render(
      <Field label="Valor" hint="em reais">
        <input />
      </Field>
    );
    expect(screen.getByText("em reais")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <Field label="Valor" hint="em reais" error="Informe um valor">
        <input />
      </Field>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Informe um valor");
    expect(screen.queryByText("em reais")).not.toBeInTheDocument();
  });

  it("required marca o asterisco", () => {
    render(
      <Field label="Nome" required>
        <input />
      </Field>
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });
});

describe("Badge / Card", () => {
  it("repassam className e children", () => {
    render(
      <Card className="p-5">
        <Badge className="bg-amber-500/15">novo</Badge>
      </Card>
    );
    const badge = screen.getByText("novo");
    expect(badge.className).toContain("bg-amber-500/15");
    expect(badge.closest("div")!.className).toContain("p-5");
  });

  it("Card aceita a tag via prop `as`", () => {
    const { container } = render(<Card as="section">x</Card>);
    expect(within(container).getByText("x").tagName).toBe("SECTION");
  });
});
