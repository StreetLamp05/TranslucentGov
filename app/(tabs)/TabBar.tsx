"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/I18nProvider";

// Bottom tab bar, after spec/UI_mockups: dark over the feed's video, light elsewhere.
// /fix and /admin/seed live outside this route group, so they never get it.
const ICON = {
  feed: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  me: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
};

function Icon({ children, size = 24, stroke = 2.2 }: { children: ReactNode; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function TabBar() {
  const t = useT();
  const pathname = usePathname();
  const onFeed = pathname === "/";

  const tab = (href: string, label: string, icon: ReactNode) => {
    const active = pathname === href;
    const color = active ? (onFeed ? "text-white" : "text-[#173F35]") : onFeed ? "text-white/60" : "text-[#7A867F]";
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex h-14 w-[68px] flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-semibold transition-colors ${
          active && !onFeed ? "bg-[#E9EDE2]" : ""
        } ${color}`}
      >
        <Icon size={21}>{icon}</Icon>
        {label}
      </Link>
    );
  };

  return (
    <nav
      aria-label={t("common.tab.nav")}
      className={`fixed inset-x-0 bottom-0 z-10 mx-auto flex h-[72px] max-w-md items-center justify-around border-t px-2 pb-[env(safe-area-inset-bottom)] ${
        onFeed ? "border-white/10 bg-black" : "border-[#E5E5DB] bg-[#FBFAF5]"
      }`}
    >
      {tab("/", t("common.tab.feed"), ICON.feed)}
      {tab("/map", t("common.tab.map"), ICON.map)}
      <Link
        href="/post"
        aria-label={t("common.tab.post")}
        aria-current={pathname === "/post" ? "page" : undefined}
        className="flex size-11 items-center justify-center rounded-[15px] bg-[#173F35] text-white shadow-[0_3px_10px_rgba(23,63,53,.18)] transition-transform hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DDF56B]"
      >
        <Icon size={22} stroke={2.8}>
          <path d="M12 5v14M5 12h14" />
        </Icon>
      </Link>
      {tab("/me", t("common.tab.me"), ICON.me)}
    </nav>
  );
}
