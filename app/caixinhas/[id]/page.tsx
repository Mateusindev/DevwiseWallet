import { Protegido } from "@/components/AppShell";
import Detalhe from "./detalhe";

// `/caixinhas/:id` — a caixinha aberta passou a ter endereço. O dado vem do
// provider do layout (já carregado), então a rota não busca nada.
export default function Page() {
  return (
    <Protegido perms={["caixinha:view"]}>
      <Detalhe />
    </Protegido>
  );
}
