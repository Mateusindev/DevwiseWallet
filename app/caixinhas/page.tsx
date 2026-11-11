import { Protegido } from "@/components/AppShell";
import Caixinhas from "@/components/Caixinhas.jsx";

// `/caixinhas` — página própria (saiu do Início). Dado vem do provider do
// layout, então a rota não busca nada.
export default function Page() {
  return (
    <Protegido perms={["caixinha:view"]}>
      <Caixinhas />
    </Protegido>
  );
}
