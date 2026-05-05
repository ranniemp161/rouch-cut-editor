import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
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
          position="bottom-right"
          theme="dark"
          richColors={false}
          closeButton
          gap={10}
          offset={20}
          duration={4000}
          toastOptions={{
            unstyled: false,
            classNames: {
              toast:
                "group !rounded-lg !border !border-zinc-800 !bg-[#161616] !text-zinc-100 " +
                "!shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.02)] " +
                "!font-sans !text-[12.5px] !backdrop-blur-md !px-3.5 !py-3",
              title: "!text-[12.5px] !font-medium !text-zinc-100 !leading-snug",
              description: "!text-[11.5px] !text-zinc-400 !mt-0.5 !leading-snug",
              actionButton:
                "!bg-violet-600 hover:!bg-violet-500 !text-white !text-[11px] !font-medium " +
                "!rounded !px-2 !py-1 !transition-colors",
              cancelButton:
                "!bg-zinc-800 hover:!bg-zinc-700 !text-zinc-300 !text-[11px] !rounded !px-2 !py-1",
              closeButton:
                "!bg-zinc-900 hover:!bg-zinc-800 !border-zinc-700 !text-zinc-400 hover:!text-zinc-200",
              success: "!border-l-2 !border-l-emerald-500/80",
              error: "!border-l-2 !border-l-red-500/80",
              info: "!border-l-2 !border-l-violet-500/80",
              warning: "!border-l-2 !border-l-amber-500/80",
              loading: "!border-l-2 !border-l-violet-500/80",
            },
          }}
        />
      </body>
    </html>
  );
}
