import type { Metadata } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { SoundProvider } from "@/lib/hooks/sound";
import DemoBanner from "./DemoBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "GovTok",
  description: "See what your city fixes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F4F1E8] font-sans text-[#18382F] antialiased">
        <I18nProvider>
          <SoundProvider>
            <DemoBanner />
            {children}
          </SoundProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
