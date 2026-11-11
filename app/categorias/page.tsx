import { Protegido } from "@/components/AppShell";
import Categorias from "@/components/Categorias.jsx";

// `/categorias` — renomear, cor, ordem, mesclar e excluir com o uso à vista.
export default function Page() {
  return (
    <Protegido perms={["categoria:view"]}>
      <Categorias />
    </Protegido>
  );
}
