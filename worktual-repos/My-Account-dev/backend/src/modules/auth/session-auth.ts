import { getActiveUserByEmail, isPasswordHashed, rehashUserPassword, sanitizeUser, verifyUserPassword } from "../users/user-store.js";
import {
  createSession,
  getSession,
  hasActiveUserSession,
  invalidateUserSessions,
  revokeSession,
} from "./sessions.js";
import {
  createSessionAlreadyActiveError,
  isSessionAlreadyActiveError,
} from "./session-concurrency.js";
import { isDatabaseConnectivityError } from "../../db/pool.js";

export { invalidateUserSessions };
export { getClientIp } from "../../infra/rateLimit.js";

const MAILBOX_BY_ROLE = {
  sales: "sales",
  finance: "finance",
  sales_admin: "sales_admin",
  number_management: "number_management",
  // Admin Graph mailbox is tied to ADMIN_EMAIL / ADMIN_LOGIN_EMAIL in .env.
  admin: "admin",
  customer: "sales",
};

export function resolveMailboxForRole(role: any) {
  return (MAILBOX_BY_ROLE as any)[role] || null;
}

export async function loginUser(email: any, password: any, { replaceSession = false } = {}) {
  const normalizedEmail = email.trim().toLowerCase();
  const storedUser = await getActiveUserByEmail(normalizedEmail);

  if (storedUser && (await verifyUserPassword(storedUser, password))) {
    if (!isPasswordHashed((storedUser as any).password)) {
      await rehashUserPassword((storedUser as any).id, password);
    }

    if ((storedUser as any).role !== "admin" && (await hasActiveUserSession((storedUser as any).id))) {
      if (replaceSession) {
        await invalidateUserSessions((storedUser as any).id);
      } else {
        throw createSessionAlreadyActiveError();
      }
    }

    const session = await createSession({
      email: (storedUser as any).email,
      role: (storedUser as any).role,
      userId: (storedUser as any).id,
      displayName: (storedUser as any).displayName || "",
    });

    return {
      ...session,
      profile: sanitizeUser(storedUser),
    };
  }

  throw new Error("Invalid email or password.");
}

export async function signInAccount(email: any, password: any, { replaceSession = false } = {}) {
  try {
    const result = await loginUser(email, password, { replaceSession });
    return { accountType: "internal", ...result };
  } catch (error) {
    if (isSessionAlreadyActiveError(error) || isDatabaseConnectivityError(error)) {
      throw error;
    }
    const { loginResellerUser } = await import("../resellers/reseller-auth.js");
    try {
      const result = await loginResellerUser(email, password, { replaceSession });
      return { accountType: "reseller", ...result };
    } catch (resellerError) {
      if (isSessionAlreadyActiveError(resellerError) || isDatabaseConnectivityError(resellerError)) {
        throw resellerError;
      }
      const { loginPartnerUser } = await import("../partners/partner-auth.js");
      try {
        const result = await loginPartnerUser(email, password, { replaceSession });
        return { accountType: "partner", ...result };
      } catch (partnerError) {
        if (isSessionAlreadyActiveError(partnerError) || isDatabaseConnectivityError(partnerError)) {
          throw partnerError;
        }
        const { loginCustomerUser } = await import("../customer-portal/customer-auth.js");
        try {
          const result = await loginCustomerUser(email, password, { replaceSession });
          return { accountType: "customer", ...result };
        } catch (customerError) {
          if (isSessionAlreadyActiveError(customerError) || isDatabaseConnectivityError(customerError)) {
            throw customerError;
          }
          throw new Error("Invalid email or password.");
        }
      }
    }
  }
}

export { isSessionAlreadyActiveError };

export async function logoutUser(token: any) {
  await revokeSession(token);
}

export { getSession };

async function readAuthSession(request: any) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return getSession(token);
}

function readBearerToken(request: any) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function requireAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireMailAuth(request: any, response: any, next: any) {
  try {
    let session = await readAuthSession(request);

    if (!session) {
      const header = request.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const { getCustomerSession } = await import("../customer-portal/customer-auth.js");
      const customerSession = await getCustomerSession(token);
      if (customerSession) {
        session = ({
          email: customerSession.email,
          role: "customer",
          userId: customerSession.customerUserId,
          displayName: customerSession.displayName || "",
        } as any);
      }
    }

    if (!session) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const mailboxProfile = resolveMailboxForRole(session.role);
    if (!mailboxProfile) {
      response.status(403).json({ error: "Mail access is not available for this role." });
      return;
    }

    request.authUser = session;
    request.mailboxProfile = mailboxProfile;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireFinanceAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "finance") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.financeUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireNumberManagementAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "number_management") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.numberManagementUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireAdminAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "admin") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.adminUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "sales") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.salesUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesAdminAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "sales_admin") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.salesAdminUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesOversightAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || (session.role !== "sales_admin" && session.role !== "admin")) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.oversightUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesAdminWriteAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "sales_admin") {
      response.status(403).json({ error: "Sales admin access required." });
      return;
    }

    request.salesAdminUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

/** Admin or sales admin — reassign leads / bulk transfer when an agent leaves. */
export async function requireLeadReassignAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || (session.role !== "sales_admin" && session.role !== "admin")) {
      response.status(403).json({ error: "Admin or sales admin access required." });
      return;
    }

    request.reassignUser = session;
    request.salesAdminUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

/** Sales agent or sales admin — customer support inbox for their accounts */
export async function requireSalesWorkspaceAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);

    if (!session || (session.role !== "sales" && session.role !== "sales_admin")) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export function getRequestBearerToken(request: any) {
  return readBearerToken(request);
}

export async function requireResellerAuth(request: any, response: any, next: any) {
  try {
    const token = readBearerToken(request);
    if (!token) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const { getResellerSession } = await import("../resellers/reseller-auth.js");
    const session = await getResellerSession(token);
    if (!session) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.resellerUser = session;
    request.authUser = {
      email: session.email,
      role: "reseller",
      userId: session.resellerUserId,
      resellerId: session.resellerId,
      displayName: session.displayName || "",
    };
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

/** Admin, finance, or partner — read commission slabs */
export async function requireCommissionSlabsReadAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);
    if (session && (session.role === "admin" || session.role === "finance")) {
      request.authUser = session;
      if (session.role === "admin") {
        request.adminUser = session;
      }
      if (session.role === "finance") {
        request.financeUser = session;
      }
      next();
      return;
    }

    const token = readBearerToken(request);
    if (token) {
      const { getPartnerSession } = await import("../partners/partner-auth.js");
      const partnerSession = await getPartnerSession(token);
      if (partnerSession) {
        request.partnerUser = partnerSession;
        request.authUser = {
          email: partnerSession.email,
          role: "partner",
          userId: partnerSession.partnerUserId,
          partnerId: partnerSession.partnerId,
          displayName: partnerSession.displayName || "",
        };
        next();
        return;
      }
    }

    response.status(401).json({ error: "Authentication required." });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

/** Sales/sales_admin staff, partner, or reseller — lead contact uniqueness checks while creating leads */
export async function requireLeadContactValidationAuth(request: any, response: any, next: any) {
  try {
    const session = await readAuthSession(request);
    if (session && (session.role === "sales" || session.role === "sales_admin" || session.role === "admin")) {
      request.authUser = session;
      next();
      return;
    }

    const token = readBearerToken(request);
    if (token) {
      const { getPartnerSession } = await import("../partners/partner-auth.js");
      const partnerSession = await getPartnerSession(token);
      if (partnerSession) {
        request.partnerUser = partnerSession;
        request.authUser = {
          email: partnerSession.email,
          role: "partner",
          userId: partnerSession.partnerUserId,
          partnerId: partnerSession.partnerId,
          displayName: partnerSession.displayName || "",
        };
        next();
        return;
      }

      const { getResellerSession } = await import("../resellers/reseller-auth.js");
      const resellerSession = await getResellerSession(token);
      if (resellerSession) {
        request.resellerUser = resellerSession;
        request.authUser = {
          email: resellerSession.email,
          role: "reseller",
          userId: resellerSession.resellerUserId,
          resellerId: resellerSession.resellerId,
          displayName: resellerSession.displayName || "",
        };
        next();
        return;
      }
    }

    response.status(401).json({ error: "Authentication required." });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requirePartnerAuth(request: any, response: any, next: any) {
  try {
    const token = readBearerToken(request);
    if (!token) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const { getPartnerSession } = await import("../partners/partner-auth.js");
    const session = await getPartnerSession(token);
    if (!session) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.partnerUser = session;
    request.authUser = {
      email: session.email,
      role: "partner",
      userId: session.partnerUserId,
      partnerId: session.partnerId,
      displayName: session.displayName || "",
    };
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}
