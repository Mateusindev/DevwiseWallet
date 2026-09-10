import { Protegido } from "@/components/AppShell";
import Cartoes from "@/components/Cartoes.jsx";

export default function Page() {
  return (
    <Protegido perms={["cartao:view"]}>
      <Cartoes />
    </Protegido>
  );
}
