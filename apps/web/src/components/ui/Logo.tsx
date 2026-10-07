import Link from "next/link";
import { BeeIcon } from "./BeeIcon";
import { cx } from "./cx";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="Honeytree home" className={cx("inline-flex items-center gap-2 rounded-md font-heading text-2xl font-semibold text-honey-300", className)}>
      <BeeIcon size={32} />
      <span className="hidden sm:inline">honeytree</span>
    </Link>
  );
}
