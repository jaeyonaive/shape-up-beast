import { createClient } from '@supabase/supabase-js';
import { getUserId } from './userId';

const SUPABASE_URL      = 'https://ubsbwfyycavvmwtozftf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IYEKv-AYvHJc_azeDdhnAQ_c-j2vABe';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Record a completed session with the device user ID.
 * Fire-and-forget — never blocks gameplay or throws to the caller.
 * Requires a `user_id` text column in the Supabase `sessions` table.
 */
export async function trackSession(): Promise<void> {
  try {
    await supabase.from('sessions').insert([
      {
        user_id:    getUserId(),
        completed:  true,
        created_at: new Date().toISOString(),
      },
    ]);
  } catch (e) {
    console.error('Session tracking failed:', e);
  }
}
