import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { CheckCircle2, XCircle, Info, AlertTriangle, Loader2 } from "lucide-react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rough Cut Editor",
  description: "Browser-based Non-Linear Editor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="h-full overflow-hidden bg-zinc-950" suppressHydrationWarning>
        {children}
        <Toaster
          position="top-center"
          theme="dark"
          richColors={false}
          closeButton
          gap={12}
          offset={32}
          duration={4000}
          icons={{
            success: (
              <span
                className="flex items-center justify-center h-8 w-8 rounded-full
                           bg-emerald-500/15 ring-1 ring-emerald-500/30
                           shadow-[0_0_18px_-2px_rgba(16,185,129,0.35)]"
              >
                <CheckCircle2 size={16} className="text-emerald-400" strokeWidth={2.4} />
              </span>
            ),
            error: (
              <span
                className="flex items-center justify-center h-8 w-8 rounded-full
                           bg-red-500/15 ring-1 ring-red-500/30
                           shadow-[0_0_18px_-2px_rgba(239,68,68,0.35)]"
              >
                <XCircle size={16} className="text-red-400" strokeWidth={2.4} />
              </span>
            ),
            info: (
              <span
                className="flex items-center justify-center h-8 w-8 rounded-full
                           bg-violet-500/15 ring-1 ring-violet-500/30
                           shadow-[0_0_18px_-2px_rgba(139,92,246,0.35)]"
              >
                <Info size={16} className="text-violet-300" strokeWidth={2.4} />
              </span>
            ),
            warning: (
              <span
                className="flex items-center justify-center h-8 w-8 rounded-full
                           bg-amber-500/15 ring-1 ring-amber-500/30
                           shadow-[0_0_18px_-2px_rgba(245,158,11,0.35)]"
              >
                <AlertTriangle size={16} className="text-amber-400" strokeWidth={2.4} />
              </span>
            ),
            loading: (
              <span
                className="flex items-center justify-center h-8 w-8 rounded-full
                           bg-violet-500/15 ring-1 ring-violet-500/30
                           shadow-[0_0_18px_-2px_rgba(139,92,246,0.35)]"
              >
                <Loader2 size={16} className="text-violet-300 animate-spin" strokeWidth={2.4} />
              </span>
            ),
          }}
          toastOptions={{
            unstyled: false,
            classNames: {
              toast:
                "group !flex !items-center !gap-3 " +
                "!rounded-xl !border !border-white/[0.07] " +
                "!bg-gradient-to-b !from-[#1c1c1f]/95 !to-[#141416]/95 " +
                "!text-zinc-100 !backdrop-blur-xl " +
                "!shadow-[0_20px_50px_-12px_rgba(0,0,0,0.75),0_0_0_1px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.06)] " +
                "!font-sans !min-w-[360px] !max-w-[440px] !px-4 !py-3.5",
              title:
                "!text-[13px] !font-semibold !text-white !leading-tight !tracking-[-0.005em]",
              description:
                "!text-[12px] !text-zinc-400 !mt-1 !leading-snug",
              icon: "!m-0 !mr-1 !shrink-0",
              content: "!gap-0.5",
              actionButton:
                "!bg-violet-600 hover:!bg-violet-500 !text-white !text-[11.5px] !font-medium " +
                "!rounded-md !px-2.5 !py-1.5 !transition-colors !shadow-sm",
              cancelButton:
                "!bg-white/[0.06] hover:!bg-white/[0.1] !text-zinc-300 !text-[11.5px] " +
                "!rounded-md !px-2.5 !py-1.5 !transition-colors",
              closeButton:
                "!bg-zinc-900/80 hover:!bg-zinc-800 !border-white/10 !text-zinc-400 " +
                "hover:!text-white !transition-colors",
            },
          }}
        />
      </body>
    </html>
  );
}
