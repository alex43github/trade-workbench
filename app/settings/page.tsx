import type { Metadata } from "next";
import ConnectionSettings from "./ConnectionSettings";

export const metadata: Metadata = {
  title: "连接设置｜街灯终端",
  description: "检查 Binance 公开行情、只读账户和 OpenAI 计划复核的服务端连接状态。",
};

export default function SettingsPage() {
  return <ConnectionSettings />;
}
