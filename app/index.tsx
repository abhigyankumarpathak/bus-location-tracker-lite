import { Redirect } from 'expo-router';
import { useAuth } from '../src/lib/auth';
import { Loading } from '../src/components/ui';

/**
 * The entry point decides nothing itself — it just sends you to the group your
 * role can see. The Stack.Protected guards in _layout are what actually enforce
 * it, and RLS is what enforces it for real.
 */
export default function Index() {
  const { session, profile, loading } = useAuth();

  if (loading) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (profile?.status !== 'active') return <Redirect href="/pending" />;

  if (profile.role === 'admin') return <Redirect href="/(admin)" />;
  if (profile.role === 'parent') return <Redirect href="/(parent)" />;
  return <Redirect href="/(student)" />;
}
