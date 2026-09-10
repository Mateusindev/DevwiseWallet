import { Protegido } from "@/components/AppShell";
import DespesasFixas from "@/components/DespesasFixas.jsx";

export default function Page() {
  return (
    <Protegido perms={["orcamento:view"]}>
      <DespesasFixas />
    </Protegido>
  );
}
