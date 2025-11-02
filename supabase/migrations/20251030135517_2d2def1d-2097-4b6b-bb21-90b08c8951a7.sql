-- Enhanced SQL Schema with better folder management

-- Create profiles table for user data
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  storage_used BIGINT DEFAULT 0,
  storage_limit BIGINT DEFAULT 5368709120, -- 5GB default
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email)
  );
  RETURN new;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create folders table
CREATE TABLE IF NOT EXISTS public.folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_folder_name_per_parent UNIQUE (name, parent_id, owner_id)
);

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

-- Folders policies
CREATE POLICY "Users can view own folders"
  ON public.folders FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create folders"
  ON public.folders FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own folders"
  ON public.folders FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own folders"
  ON public.folders FOR DELETE
  USING (auth.uid() = owner_id);

-- Create files table
CREATE TABLE IF NOT EXISTS public.files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- Files policies
CREATE POLICY "Users can view own files"
  ON public.files FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create files"
  ON public.files FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own files"
  ON public.files FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own files"
  ON public.files FOR DELETE
  USING (auth.uid() = owner_id);

-- Create share links table
CREATE TABLE IF NOT EXISTS public.share_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  password TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  download_limit INTEGER,
  download_count INTEGER DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

-- Share links policies
CREATE POLICY "Users can view own share links"
  ON public.share_links FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create share links"
  ON public.share_links FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own share links"
  ON public.share_links FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own share links"
  ON public.share_links FOR DELETE
  USING (auth.uid() = created_by);

-- Create storage bucket for files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('user-files', 'user-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for user files
CREATE POLICY "Users can view own files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload own files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE OR REPLACE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_folders_updated_at
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_files_updated_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update storage usage
CREATE OR REPLACE FUNCTION update_storage_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- only count non-deleted files
    IF NOT COALESCE(NEW.is_deleted, FALSE) THEN
      UPDATE public.profiles 
      SET storage_used = storage_used + NEW.file_size
      WHERE id = NEW.owner_id;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF NOT COALESCE(OLD.is_deleted, FALSE) THEN
      UPDATE public.profiles 
      SET storage_used = GREATEST(0, storage_used - OLD.file_size)
      WHERE id = OLD.owner_id;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- owner changed
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      -- subtract from old owner if previously counted
      IF NOT COALESCE(OLD.is_deleted, FALSE) THEN
        UPDATE public.profiles 
        SET storage_used = GREATEST(0, storage_used - OLD.file_size)
        WHERE id = OLD.owner_id;
      END IF;
      -- add to new owner if currently counted
      IF NOT COALESCE(NEW.is_deleted, FALSE) THEN
        UPDATE public.profiles 
        SET storage_used = storage_used + NEW.file_size
        WHERE id = NEW.owner_id;
      END IF;

    ELSE
      -- same owner: handle size changes and soft-delete toggles
      IF NOT COALESCE(OLD.is_deleted, FALSE) AND NOT COALESCE(NEW.is_deleted, FALSE) THEN
        -- both counted: adjust by size delta
        IF NEW.file_size <> OLD.file_size THEN
          UPDATE public.profiles 
          SET storage_used = storage_used + (NEW.file_size - OLD.file_size)
          WHERE id = NEW.owner_id;
        END IF;

      ELSIF NOT COALESCE(OLD.is_deleted, FALSE) AND COALESCE(NEW.is_deleted, FALSE) THEN
        -- was counted, now deleted -> subtract
        UPDATE public.profiles 
        SET storage_used = GREATEST(0, storage_used - OLD.file_size)
        WHERE id = NEW.owner_id;

      ELSIF COALESCE(OLD.is_deleted, FALSE) AND NOT COALESCE(NEW.is_deleted, FALSE) THEN
        -- was deleted, now restored -> add
        UPDATE public.profiles 
        SET storage_used = storage_used + NEW.file_size
        WHERE id = NEW.owner_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger for storage usage
DROP TRIGGER IF EXISTS on_file_storage_change ON public.files;
CREATE TRIGGER on_file_storage_change
  AFTER INSERT OR DELETE OR UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION update_storage_usage();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_files_owner_id ON public.files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON public.files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_deleted ON public.files(is_deleted);
CREATE INDEX IF NOT EXISTS idx_folders_owner_id ON public.folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON public.folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON public.share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_file_id ON public.share_links(file_id);

-- Helper function for share links
CREATE OR REPLACE FUNCTION public.get_file_by_token(p_token text, p_password text DEFAULT NULL)
RETURNS TABLE(
  file_id uuid,
  file_path text,
  file_name text,
  original_name text,
  file_type text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sl RECORD;
BEGIN
  SELECT * INTO sl
  FROM public.share_links
  WHERE token = p_token
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive token';
  END IF;

  IF sl.expires_at IS NOT NULL AND sl.expires_at < NOW() THEN
    RAISE EXCEPTION 'Token expired';
  END IF;

  IF sl.password IS NOT NULL AND sl.password <> p_password THEN
    RAISE EXCEPTION 'Invalid password';
  END IF;

  IF sl.download_limit IS NOT NULL AND sl.download_count >= sl.download_limit THEN
    RAISE EXCEPTION 'Download limit reached';
  END IF;

  -- increment count
  UPDATE public.share_links
  SET download_count = download_count + 1
  WHERE id = sl.id;

  -- return file metadata
  RETURN QUERY
  SELECT f.id, f.file_path, f.name, f.original_name, f.file_type
  FROM public.files f
  WHERE f.id = sl.file_id
    AND NOT COALESCE(f.is_deleted, FALSE);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'File not available';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_file_by_token(text, text) TO public;

-- Ensure pgcrypto for secure tokens
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create share link server-side (secure token generation + ownership check)
CREATE OR REPLACE FUNCTION public.create_share_link(
  p_file_id uuid,
  p_expires_hours integer DEFAULT NULL,
  p_password text DEFAULT NULL,
  p_download_limit integer DEFAULT NULL
)
RETURNS TABLE(share_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner uuid;
  uid uuid := auth.uid()::uuid;
  gen_token text := encode(gen_random_bytes(6), 'hex');
  rec RECORD;
BEGIN
  SELECT owner_id INTO owner FROM public.files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'File not found';
  END IF;
  IF owner IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.share_links (file_id, token, password, expires_at, download_limit, created_by)
  VALUES (
    p_file_id,
    gen_token,
    p_password,
    CASE WHEN p_expires_hours IS NOT NULL THEN NOW() + (p_expires_hours || ' hours')::interval ELSE NULL END,
    p_download_limit,
    uid
  )
  RETURNING id, token, expires_at INTO rec;

  share_id := rec.id;
  token := rec.token;
  expires_at := rec.expires_at;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_share_link(uuid, integer, text, integer) TO public;

-- Rename file (DB only). If you need to rename storage object, call storage API from frontend and then call this RPC.
CREATE OR REPLACE FUNCTION public.rename_file(p_file_id uuid, p_new_name text, p_new_original_name text DEFAULT NULL)
RETURNS TABLE(file_id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid()::uuid;
  owner uuid;
BEGIN
  SELECT owner_id INTO owner FROM public.files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'File not found';
  END IF;
  IF owner IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.files
  SET name = p_new_name,
      original_name = COALESCE(p_new_original_name, original_name)
  WHERE id = p_file_id
  RETURNING id, name INTO file_id, name;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_file(uuid, text, text) TO public;

-- Soft delete and restore RPCs (return file_path so frontend can decide to remove storage object)
CREATE OR REPLACE FUNCTION public.soft_delete_file(p_file_id uuid)
RETURNS TABLE(file_id uuid, file_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid()::uuid;
  owner uuid;
BEGIN
  SELECT owner_id, file_path INTO owner, file_path FROM public.files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'File not found';
  END IF;
  IF owner IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.files
  SET is_deleted = TRUE,
      deleted_at = NOW()
  WHERE id = p_file_id;

  file_id := p_file_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_file(uuid) TO public;

CREATE OR REPLACE FUNCTION public.restore_file(p_file_id uuid)
RETURNS TABLE(file_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid()::uuid;
  owner uuid;
BEGIN
  SELECT owner_id INTO owner FROM public.files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'File not found';
  END IF;
  IF owner IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.files
  SET is_deleted = FALSE,
      deleted_at = NULL
  WHERE id = p_file_id;

  file_id := p_file_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_file(uuid) TO public;

-- Permanently delete a file DB record and return its storage path so frontend can remove the storage object
CREATE OR REPLACE FUNCTION public.permanently_delete_file(p_file_id uuid)
RETURNS TABLE(file_id uuid, file_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid()::uuid;
  owner uuid;
  fpath text;
BEGIN
  SELECT owner_id, file_path INTO owner, fpath FROM public.files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'File not found';
  END IF;
  IF owner IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.files WHERE id = p_file_id;

  file_id := p_file_id;
  file_path := fpath;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.permanently_delete_file(uuid) TO public;

-- Bulk insert many file records in one call; owner is set to auth.uid()
-- Expected input: jsonb array of objects with keys: name, original_name, file_path, file_type, file_size, folder_id (optional)
CREATE OR REPLACE FUNCTION public.bulk_insert_files(p_records jsonb)
RETURNS SETOF public.files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid()::uuid;
BEGIN
  RETURN QUERY
  INSERT INTO public.files (name, original_name, file_path, file_type, file_size, folder_id, owner_id)
  SELECT r.name, r.original_name, r.file_path, r.file_type, r.file_size::bigint, (CASE WHEN r.folder_id IS NULL THEN NULL ELSE r.folder_id::uuid END), uid
  FROM jsonb_to_recordset(p_records) AS r(name text, original_name text, file_path text, file_type text, file_size text, folder_id text)
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_insert_files(jsonb) TO public;

-- Paginated listing for frontend convenience (only returns files owned by caller)
CREATE OR REPLACE FUNCTION public.list_files(
  p_folder_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_include_deleted boolean DEFAULT FALSE
)
RETURNS SETOF public.files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid()::uuid;
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.files
  WHERE owner_id = uid
    AND ( (p_folder_id IS NULL AND folder_id IS NULL) OR (p_folder_id IS NOT NULL AND folder_id = p_folder_id) )
    AND (p_include_deleted OR NOT COALESCE(is_deleted, FALSE))
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_files(uuid, integer, integer, boolean) TO public;

-- Fix NULL handling in database schema
ALTER TABLE files ALTER COLUMN folder_id DROP NOT NULL;
ALTER TABLE folders ALTER COLUMN parent_id DROP NOT NULL;

-- Ensure proper indexes exist
CREATE INDEX IF NOT EXISTS idx_files_owner_id ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_owner_id ON folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);

-- Update storage policies
DROP POLICY IF EXISTS "Users can view own files" ON files;
CREATE POLICY "Users can view own files" ON files
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can view own folders" ON folders;
CREATE POLICY "Users can view own folders" ON folders
  FOR SELECT USING (auth.uid() = owner_id);