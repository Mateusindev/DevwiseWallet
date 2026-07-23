import type { Prisma } from "@prisma/client";
import { adminRepository, type AdminUser } from "./admin.repository";
import { hashPassword } from "@/server/auth/password";
import { AppError, NotFoundError } from "@/server/lib/errors";
import type { CreateUserDTO, UpdateUserDTO, CreateRoleDTO, UpdateRoleDTO } from "./admin.dto";

type RoleRow = { id: string; nome: string; descricao: string | null; permissions: string[]; _count?: { users: number } };

function userView(u: AdminUser) {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    ativo: u.ativo,
    roles: u.roles.map((ur) => ({ id: ur.role.id, nome: ur.role.nome })),
    permissions: [...new Set(u.roles.flatMap((ur) => ur.role.permissions))],
  };
}

function roleView(r: RoleRow) {
  return {
    id: r.id,
    nome: r.nome,
    descricao: r.descricao,
    permissions: r.permissions,
    usuarios: r._count?.users ?? 0,
  };
}

async function assertRolesExist(roleIds: string[]) {
  if (roleIds.length === 0) return;
  const found = await adminRepository.countRolesByIds([...new Set(roleIds)]);
  if (found !== new Set(roleIds).size) throw new AppError("Role inexistente na lista", 422);
}

export const adminService = {
  // ── Users ──────────────────────────────────────────────────────────────────
  async listUsers() {
    return (await adminRepository.listUsers()).map(userView);
  },

  async createUser(dto: CreateUserDTO) {
    const email = dto.email.toLowerCase().trim();
    if (await adminRepository.findUserByEmail(email)) {
      throw new AppError("Email já cadastrado", 409);
    }
    await assertRolesExist(dto.roleIds);
    const u = await adminRepository.createUser({
      email,
      nome: dto.nome,
      senhaHash: hashPassword(dto.senha),
      roleIds: [...new Set(dto.roleIds)],
    });
    return userView(u);
  },

  async updateUser(id: string, dto: UpdateUserDTO, actorId: string) {
    const existing = await adminRepository.findUser(id);
    if (!existing) throw new NotFoundError(`Usuário não encontrado: ${id}`);

    // não deixa o usuário se trancar pra fora
    if (id === actorId && (dto.ativo === false || (dto.roleIds && dto.roleIds.length === 0))) {
      throw new AppError("Não dá pra desativar ou remover as próprias roles.");
    }

    const data: { email?: string; nome?: string; senhaHash?: string; ativo?: boolean } = {};
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      const clash = await adminRepository.findUserByEmail(email);
      if (clash && clash.id !== id) throw new AppError("Email já cadastrado", 409);
      data.email = email;
    }
    if (dto.nome !== undefined) data.nome = dto.nome;
    if (dto.senha !== undefined) data.senhaHash = hashPassword(dto.senha);
    if (dto.ativo !== undefined) data.ativo = dto.ativo;
    if (dto.roleIds !== undefined) await assertRolesExist(dto.roleIds);

    const u = await adminRepository.updateUser(
      id,
      data,
      dto.roleIds !== undefined ? [...new Set(dto.roleIds)] : undefined
    );
    return userView(u);
  },

  async deleteUser(id: string, actorId: string) {
    if (id === actorId) throw new AppError("Não dá pra excluir o próprio usuário.");
    const existing = await adminRepository.findUser(id);
    if (!existing) throw new NotFoundError(`Usuário não encontrado: ${id}`);
    await adminRepository.deleteUser(id);
    return { id };
  },

  // ── Roles ──────────────────────────────────────────────────────────────────
  async listRoles() {
    return (await adminRepository.listRoles()).map(roleView);
  },

  async createRole(dto: CreateRoleDTO) {
    if (await adminRepository.findRoleByName(dto.nome)) {
      throw new AppError("Já existe role com esse nome", 409);
    }
    const r = await adminRepository.createRole({
      nome: dto.nome,
      descricao: dto.descricao ?? null,
      permissions: [...new Set(dto.permissions)],
    });
    return roleView(r);
  },

  async updateRole(id: string, dto: UpdateRoleDTO) {
    const existing = await adminRepository.findRole(id);
    if (!existing) throw new NotFoundError(`Role não encontrada: ${id}`);
    if (dto.nome && dto.nome !== existing.nome) {
      if (await adminRepository.findRoleByName(dto.nome)) {
        throw new AppError("Já existe role com esse nome", 409);
      }
    }
    const data: Prisma.RoleUpdateInput = {};
    if (dto.nome !== undefined) data.nome = dto.nome;
    if (dto.descricao !== undefined) data.descricao = dto.descricao ?? null;
    if (dto.permissions !== undefined) data.permissions = [...new Set(dto.permissions)];
    const r = await adminRepository.updateRole(id, data);
    return roleView(r);
  },

  async deleteRole(id: string) {
    const existing = await adminRepository.findRole(id);
    if (!existing) throw new NotFoundError(`Role não encontrada: ${id}`);
    await adminRepository.deleteRole(id); // user_roles caem em cascata
    return { id };
  },
};
