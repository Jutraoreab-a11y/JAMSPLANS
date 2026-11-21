import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "JamsPlans",
  description: "Objectifs, routines et regularite au quotidien.",
};

export default function JamsPlansLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
