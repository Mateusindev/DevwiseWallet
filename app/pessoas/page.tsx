import { Protegido } from "@/components/AppShell";
import Pessoas from "@/components/Pessoas.jsx";

export default function Page() {
  return (
    <Protegido perms={["cartao:share", "cartao:view_shared", "share:manage", "share:view_shared"]}>
      <Pessoas />
    </Protegido>
  );
}
