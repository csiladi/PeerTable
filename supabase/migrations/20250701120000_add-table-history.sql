-- Table to store cell modification history for collaborative tables
CREATE TABLE public.table_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id UUID REFERENCES public.peer_tables(id) ON DELETE CASCADE NOT NULL,
  row_index INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  old_value TEXT,
  new_value TEXT,
  modified_by UUID REFERENCES auth.users(id),
  modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable realtime for table_history
ALTER TABLE public.table_history REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.table_history; 