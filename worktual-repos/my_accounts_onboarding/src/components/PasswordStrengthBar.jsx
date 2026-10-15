import { useMemo } from "react";

import { getPasswordStrength } from "../lib/passwordPolicy.js";

export function PasswordStrengthBar({ password }) {
  const strength = useMemo(() => getPasswordStrength(password), [password]);

  if (!password) {
    return null;
  }

  return (
    <div aria-live="polite" className="password-strength">
      <div className="password-strength__track" role="presentation">
        <span
          className={`password-strength__fill password-strength__fill--${strength.tone}`}
          style={{ width: `${strength.score}%` }}
        />
      </div>
      <span className={`password-strength__label password-strength__label--${strength.tone}`}>
        {strength.label}
      </span>
    </div>
  );
}
