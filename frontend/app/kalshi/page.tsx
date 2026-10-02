import type { Metadata } from "next";
import KalshiDashboard from "../../components/KalshiDashboard";

export const metadata: Metadata = {
  title: "Caterium Kalshi — Paper Testing Demo",
};
export default function KalshiPage() {
  return <KalshiDashboard />;
}
