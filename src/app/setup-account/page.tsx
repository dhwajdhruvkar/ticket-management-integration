import type { Metadata } from "next";
import SetupAccountClient from "./SetupAccountClient";

export const metadata: Metadata = {
  title: "Set up account | Netlink Support",
  robots: { index: false, follow: false },
};

export default function SetupAccountPage() {
  return <SetupAccountClient />;
}
