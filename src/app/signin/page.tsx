import { config } from "@/server/config";
import SignInClient from "./SignInClient";

// Server half of the sign-in screen: reads which auth providers exist in this
// deployment (demo credentials only in demo mode; Entra ID when configured;
// otherwise an API-only notice) so the client never renders an option that
// would fail.

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return <SignInClient ssoEnabled={config.features.entraId} demoMode={config.demoMode} />;
}
