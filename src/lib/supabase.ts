import { supabase } from "@/integrations/supabase/client";

export { supabase };

// Helper function to get user session
export const getSession = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
};

// Helper function to sign out
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};
