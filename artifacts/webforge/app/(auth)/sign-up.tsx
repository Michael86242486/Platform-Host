import { Redirect } from "expo-router";

// In the new magic-link flow there is no separate sign-up step — entering
// an email on the sign-in screen creates the account on first use.
export default function SignUpScreen() {
  return <Redirect href="/(auth)/sign-in" />;
}
