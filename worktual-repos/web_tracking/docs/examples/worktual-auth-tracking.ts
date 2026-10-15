/**
 * Booxoo / SPA auth tracking helpers — login, register, form success/failure.
 * Copy into the storefront (e.g. analytics/worktualEcommerce.ts).
 *
 * Requires WorktualAnalytics.init() on every page (formSuccess/formFailure enabled by SDK default).
 */

declare global {
  interface Window {
    WorktualAnalytics?: {
      login: (props: Record<string, unknown>) => void;
      register: (props: Record<string, unknown>) => void;
      signup?: (props: Record<string, unknown>) => void;
      formSuccess: (formId: string, props?: Record<string, unknown>) => void;
      formFailure: (formId: string, props?: Record<string, unknown>) => void;
      flush?: () => Promise<void>;
    };
  }
}

export type WorktualIdentityInput = {
  userId: string;
  method: "email" | "google";
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
};

function identityProps(input: WorktualIdentityInput) {
  const out: Record<string, string> = {
    userId: String(input.userId),
    method: input.method,
  };
  if (input.email) out.email = input.email;
  if (input.phone) out.phone = input.phone;
  if (input.firstName) out.firstName = input.firstName;
  if (input.lastName) out.lastName = input.lastName;
  return out;
}

/** After successful login API response — sends form_success + login + identify traits. */
export async function trackWorktualLogin(
  input: WorktualIdentityInput & { formId?: string },
) {
  try {
    const analytics = window.WorktualAnalytics;
    if (!analytics?.login) return false;

    if (input.formId && analytics.formSuccess) {
      analytics.formSuccess(input.formId);
    }

    analytics.login(identityProps(input));
    await analytics.flush?.();
    return true;
  } catch {
    return false;
  }
}

/** After successful register API response — form label, method, and event all use `register`. */
export async function trackWorktualRegister(
  input: WorktualIdentityInput & { formId?: string; source?: string },
) {
  try {
    const analytics = window.WorktualAnalytics;
    const registerFn = analytics?.register ?? analytics?.signup;
    if (!registerFn) return false;

    if (input.formId && analytics.formSuccess) {
      analytics.formSuccess(input.formId);
    }

    const props = identityProps(input);
    if (input.source) props.source = input.source;

    registerFn(props);
    await analytics.flush?.();
    return true;
  } catch {
    return false;
  }
}

/** @deprecated Use trackWorktualRegister */
export const trackWorktualSignup = trackWorktualRegister;

/** Failed AJAX login or register — no password or field values sent. */
export async function trackWorktualFormFailure(formId: string, reason: string) {
  try {
    const analytics = window.WorktualAnalytics;
    if (!analytics?.formFailure) return false;

    analytics.formFailure(formId, { reason });
    await analytics.flush?.();
    return true;
  } catch {
    return false;
  }
}
