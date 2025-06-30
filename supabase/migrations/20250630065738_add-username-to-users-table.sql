-- Add username column to table_users
ALTER TABLE public.table_users ADD COLUMN username TEXT;

-- Update all existing users to have username as the part before '@' in their email
-- This requires joining with the auth.users table to get the email
UPDATE public.table_users tu
SET username = split_part(au.email, '@', 1)
FROM auth.users au
WHERE tu.user_id = au.id;

-- Optionally, set NOT NULL if you want to enforce it for new rows (after backfilling)
-- ALTER TABLE public.table_users ALTER COLUMN username SET NOT NULL;
