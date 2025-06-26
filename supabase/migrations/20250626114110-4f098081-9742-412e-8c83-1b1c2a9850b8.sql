
-- Create a table to store collaborative tables
CREATE TABLE public.peer_tables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create a table to store table data (rows and columns)
CREATE TABLE public.table_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id UUID REFERENCES public.peer_tables(id) ON DELETE CASCADE NOT NULL,
  row_index INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  value TEXT,
  last_modified_by UUID REFERENCES auth.users(id),
  last_modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(table_id, row_index, column_index)
);

-- Create a table to track active users in each table
CREATE TABLE public.table_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id UUID REFERENCES public.peer_tables(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  cursor_position JSONB,
  UNIQUE(table_id, user_id)
);

-- Enable Row Level Security
ALTER TABLE public.peer_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_users ENABLE ROW LEVEL SECURITY;

-- RLS Policies for peer_tables
CREATE POLICY "Users can view all tables" ON public.peer_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create tables" ON public.peer_tables FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update their own tables" ON public.peer_tables FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Users can delete their own tables" ON public.peer_tables FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- RLS Policies for table_data
CREATE POLICY "Users can view table data" ON public.table_data FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert table data" ON public.table_data FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update table data" ON public.table_data FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Users can delete table data" ON public.table_data FOR DELETE TO authenticated USING (true);

-- RLS Policies for table_users
CREATE POLICY "Users can view table users" ON public.table_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert their presence" ON public.table_users FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their presence" ON public.table_users FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their presence" ON public.table_users FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Enable realtime for all tables
ALTER TABLE public.peer_tables REPLICA IDENTITY FULL;
ALTER TABLE public.table_data REPLICA IDENTITY FULL;
ALTER TABLE public.table_users REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.peer_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE public.table_data;
ALTER PUBLICATION supabase_realtime ADD TABLE public.table_users;
