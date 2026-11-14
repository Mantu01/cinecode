export type UserRole = "Viewer" | "Author" | "Admin";

export type PermissionAction =
  | "preview:read"
  | "timeline:scrub"
  | "composition:edit"
  | "render:preview"
  | "render:final"
  | "cache:purge"
  | "plugin:manage"
  | "config:modify";

const ROLE_PERMISSIONS: Record<UserRole, Set<PermissionAction>> = {
  Viewer: new Set(["preview:read", "timeline:scrub"]),
  Author: new Set([
    "preview:read",
    "timeline:scrub",
    "composition:edit",
    "render:preview",
  ]),
  Admin: new Set([
    "preview:read",
    "timeline:scrub",
    "composition:edit",
    "render:preview",
    "render:final",
    "cache:purge",
    "plugin:manage",
    "config:modify",
  ]),
};

export interface AuthContext {
  userId: string;
  role: UserRole;
  token?: string;
}

export class AccessController {
  private staticTokens = new Map<string, { userId: string; role: UserRole }>();

  constructor() {
    if (process.env.CINECODE_ADMIN_TOKEN) {
      this.staticTokens.set(process.env.CINECODE_ADMIN_TOKEN, { userId: "admin", role: "Admin" });
    }
  }

  registerToken(token: string, userId: string, role: UserRole): void {
    this.staticTokens.set(token, { userId, role });
  }

  authenticate(tokenOrHeader?: string): AuthContext {
    if (!tokenOrHeader) {
      return { userId: "anonymous", role: "Viewer" };
    }

    const token = tokenOrHeader.startsWith("Bearer ") ? tokenOrHeader.substring(7).trim() : tokenOrHeader.trim();
    const found = this.staticTokens.get(token);
    if (found) {
      return { userId: found.userId, role: found.role, token };
    }

    return { userId: "authenticated_user", role: "Author", token };
  }

  authorize(role: UserRole, action: PermissionAction): boolean {
    const permissions = ROLE_PERMISSIONS[role];
    return permissions ? permissions.has(action) : false;
  }

  enforce(role: UserRole, action: PermissionAction): void {
    if (!this.authorize(role, action)) {
      throw new Error(`Forbidden: Role '${role}' lacks permission for action '${action}'`);
    }
  }
}

export const accessController = new AccessController();
