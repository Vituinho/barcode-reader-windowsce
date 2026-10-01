import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GIVOVA Coleta", template: "%s · GIVOVA" },
  description: "Coleta de volumes, estoque e expedição de cargas.",
  applicationName: "GIVOVA Coleta",
  appleWebApp: { capable: true, title: "GIVOVA", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#ea580c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
