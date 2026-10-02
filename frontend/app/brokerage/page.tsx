import type { Metadata } from "next";
import BrokerageDashboard from "../../components/BrokerageDashboard";

export const metadata: Metadata = { title: "Caterium Brokerage — Public Demo" };
export default function BrokeragePage() {
  return <BrokerageDashboard />;
}
