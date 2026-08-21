# BandAid v2.1 quick rollout checklist

1. **Do not deploy v2.0 or v2.0.1.** Keep v1.9.2 as the rollback point.
2. In `supabase_v2_1_consolidated.sql`, replace `CHANGE_THIS_BETA_CODE` with your private invite code.
3. Run that SQL once in Supabase SQL Editor.
4. Authentication → Email: turn **Confirm email OFF**.
5. Authentication password settings: minimum length **6** and make sure password character requirements permit digits-only PINs for this private beta.
6. Keep/tighten Supabase Auth rate limits because 6-digit PINs are weaker than normal passwords.
7. Upload the v2.1 app files to the root of GitHub repository `BandAid`.
8. Create your own account first.
9. Promote only your username with:
   `update public.profiles set is_admin = true where username = 'YOUR_USERNAME';`
10. Deploy the Edge Function in `supabase/functions/admin-reset-pin/index.ts` as `admin-reset-pin`.
11. Log out/in, open **Admin**, and verify the user/session dashboard.
12. Give the beta URL + invite code to testers.
