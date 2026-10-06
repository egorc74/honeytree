import { cx } from "./cx";

/** Small bee glyph used on the like button and the logo. */
export function BeeIcon({ size = 20, className, filled = true }: { size?: number; className?: string; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cx("shrink-0", className)} aria-hidden focusable="false">
      <ellipse cx="11" cy="9" rx="6" ry="4" transform="rotate(-25 11 9)" fill="#FFF8E1" stroke="#3B2414" strokeWidth="1.6" opacity={filled ? 1 : 0.7} />
      <ellipse cx="21" cy="9" rx="6" ry="4" transform="rotate(25 21 9)" fill="#FFF8E1" stroke="#3B2414" strokeWidth="1.6" opacity={filled ? 1 : 0.7} />
      <ellipse cx="16" cy="19" rx="9" ry="8" fill={filled ? "#F5B700" : "none"} stroke="#3B2414" strokeWidth="1.8" />
      <path d="M8.5 17.5c5 1.4 10 1.4 15 0M8.7 22c4.6 1.3 9.9 1.3 14.6 0" stroke="#3B2414" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="13" cy="15" r="1.1" fill="#3B2414" />
      <circle cx="19" cy="15" r="1.1" fill="#3B2414" />
      <path d="M13 8.5L11 4.5M19 8.5L21 4.5" stroke="#3B2414" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
