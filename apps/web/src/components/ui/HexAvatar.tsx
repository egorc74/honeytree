/* eslint-disable @next/next/no-img-element */
import { initials } from "@/lib/format";
import { cx } from "./cx";
import { HEX_CLIP } from "./Hexagon";

const SIZES = { xs: 28, sm: 36, md: 48, lg: 72, xl: 120 } as const;

/** Hexagon avatar: honey ring around the user's picture, falling back to initials. */
export function HexAvatar({
  src,
  name,
  size = "md",
  className,
  ring = true,
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  ring?: boolean;
}) {
  const px = SIZES[size];
  return (
    <span
      className={cx("inline-grid shrink-0 place-items-center bg-primary", className)}
      style={{ width: px, height: px * 1.08, clipPath: HEX_CLIP, padding: ring ? Math.max(2, px / 16) : 0 }}
      role="img"
      aria-label={`${name}'s avatar`}
    >
      <span className="grid h-full w-full place-items-center bg-surface" style={{ clipPath: HEX_CLIP }}>
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" width={px} height={px} loading="lazy" />
        ) : (
          <span className="font-heading font-semibold text-fg" style={{ fontSize: px / 3 }} aria-hidden>
            {initials(name)}
          </span>
        )}
      </span>
    </span>
  );
}
