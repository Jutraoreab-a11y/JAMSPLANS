import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carnet de Discipline",
  description: "Suivi d'objectifs, routines et discipline quotidienne.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="font-sans">{children}</body>
    </html>
  );
}
