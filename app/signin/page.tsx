import type { Metadata } from "next";
import OperatorGate from "../components/OperatorGate";

export const metadata: Metadata = {
  title: "安全登录｜街灯终端",
  description: "使用服务端管理员会话访问受保护的交易工作台操作。",
};

export default function SignInPage() {
  return <OperatorGate standalone />;
}
