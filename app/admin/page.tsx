import { Protegido } from "@/components/AppShell";
import Admin from "@/components/Admin";

export default function Page() {
  return (
    <Protegido perms={["user:view", "role:view"]}>
      <Admin />
    </Protegido>
  );
}
