// @ts-nocheck
import { getAvatarTone, getProfileInitials } from "../lib/brandColors.js";

/**
 * Colored initials avatar from the Worktual accent palette.
 * Soft wash background + accent text; same seed → same color.
 *
 * @param {object} props
 * @param {string} [props.seed] — stable id / email preferred for color hashing
 * @param {string} [props.name]
 * @param {string} [props.email]
 * @param {string} [props.className] — layout base (e.g. admin-users-name-cell__avatar)
 * @param {"sm"|"md"|"lg"} [props.size] — only when using `.profile-avatar` base
 * @param {string} [props.title]
 */
export function ProfileAvatar({
  seed = "",
  name = "",
  email = "",
  className = "profile-avatar",
  size,
  title,
}) {
  const hashSeed = String(seed || email || name || "");
  const tone = getAvatarTone(hashSeed);
  const initials = getProfileInitials(name, email);
  const sizeClass = size ? `profile-avatar--${size}` : "";
  const classes = [className, `${className}--${tone}`, sizeClass].filter(Boolean).join(" ");

  return (
    <span aria-hidden="true" className={classes} title={title}>
      {initials}
    </span>
  );
}
