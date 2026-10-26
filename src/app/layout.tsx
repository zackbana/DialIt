import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "DialIt", description: "Beacon Consulting video dial testing" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
