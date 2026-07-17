// Route /profile — the signed-in user's account page (identity, contact fields,
// notification preferences, activity). Thin wrapper around ProfileView.
import { Suspense } from "react";
import ProfileView from "@/components/ProfileView";

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileView />
    </Suspense>
  );
}
