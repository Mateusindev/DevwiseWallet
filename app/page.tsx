import { Protegido } from "@/components/AppShell";
import Inicio from "./inicio";

// Rota "/" — Início. Página fina de propósito: quem tem os dados é o provider
// do layout, então a troca de rota não custa nenhuma ida ao banco.
export default function Page() {
  return (
    <Protegido perms={["caixinha:view"]}>
      <Inicio />
    </Protegido>
  );
}
