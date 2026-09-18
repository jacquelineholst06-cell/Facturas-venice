import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lúmina — Facturas y gastos",
  description: "Organiza facturas y gastos de tu negocio en España.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
