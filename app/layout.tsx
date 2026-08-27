import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import OperatorGate from "./components/OperatorGate";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  let origin: URL;
  try {
    origin = new URL(`${protocol}://${host}`);
  } catch {
    origin = new URL("http://localhost:3000");
  }
  const socialImage = new URL("/og.png", origin).toString();
  const title = "交易议会｜多专家 AI 行情咨询与实盘策略";
  const description = "ICT、街哥、静心与bit浪浪四套体系的结构化会诊、实盘策略与可追溯复盘。真实订单仅在安全条件和人工最终确认均满足后提交。";

  return {
    metadataBase: origin,
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: socialImage, width: 1672, height: 939, alt: "交易议会" }] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><OperatorGate>{children}</OperatorGate></body>
    </html>
  );
}
