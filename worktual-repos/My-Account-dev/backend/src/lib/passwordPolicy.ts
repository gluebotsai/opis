const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters and include 1 uppercase letter, 1 number, and 1 special character.";

export function getPasswordPolicyMessage() {
  return PASSWORD_POLICY_MESSAGE;
}

export function getPasswordStrengthChecks(password: any) {
  const value = String(password || "");
  return {
    length: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    special: /[^A-Za-z0-9]/.test(value),
  };
}

export function getPasswordStrength(password: any) {
  const value = String(password || "");
  const checks = getPasswordStrengthChecks(value);
  const passed = Object.values(checks).filter(Boolean).length;

  if (!value) {
    return { score: 0, label: "", tone: "empty", checks };
  }

  const score = Math.round((passed / 4) * 100);

  if (passed === 4) {
    return { score, label: "Strong", tone: "strong", checks };
  }
  if (passed === 3) {
    return { score, label: "Good", tone: "good", checks };
  }
  if (passed === 2) {
    return { score, label: "Fair", tone: "fair", checks };
  }

  return { score, label: "Weak", tone: "weak", checks };
}

export function isStrongPassword(password: any) {
  const value = String(password || "");
  if (value.length < 8) {
    return false;
  }
  if (!/[A-Z]/.test(value)) {
    return false;
  }
  if (!/[0-9]/.test(value)) {
    return false;
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return false;
  }
  return true;
}

export function validatePasswordPolicy(password: any) {
  if (!isStrongPassword(password)) {
    throw new Error(PASSWORD_POLICY_MESSAGE);
  }
}
