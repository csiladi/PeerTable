import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Tables } from '@/integrations/supabase/types';
import { Plus } from 'lucide-react';

interface Props {
  onSelectTable: (tableId: string, tableName: string) => void;
}

export const TablesList = ({ onSelectTable }: Props) => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [tables, setTables] = useState<Tables<'peer_tables'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTableName, setNewTableName] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deletingTableId, setDeletingTableId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const loadTables = async () => {
    try {
      const { data, error } = await supabase
        .from('peer_tables')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTables(data || []);
    } catch (error: unknown) {
      toast({ title: "Error loading tables", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const createTable = async () => {
    if (!newTableName.trim()) return;

    try {
      const { data, error } = await supabase
        .from('peer_tables')
        .insert({
          name: newTableName,
          created_by: user!.id,
        })
        .select()
        .single();

      if (error) throw error;

      setTables(prev => [data, ...prev]);
      if (user?.id && user?.email) {
        const username = user.email.split('@')[0];
        await supabase.from('table_users').insert({
          table_id: data.id,
          user_id: user.id,
          username,
          last_seen: new Date().toISOString(),
        });
      }
      setNewTableName('');
      setCreateDialogOpen(false);
      toast({ title: "Table created successfully!" });
    } catch (error: unknown) {
      toast({ title: "Error creating table", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    try {
      const { error } = await supabase.from('peer_tables').delete().eq('id', tableId);
      if (error) throw error;
      setTables(prev => prev.filter(t => t.id !== tableId));
      toast({ title: 'Table deleted successfully!' });
    } catch (error: unknown) {
      toast({ title: 'Error deleting table', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setShowDeleteDialog(false);
      setDeletingTableId(null);
    }
  };

  useEffect(() => {
    loadTables();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-900">
        <div className="text-lg text-gray-700 dark:text-gray-200">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50 dark:bg-zinc-900">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6 rounded-lg bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-gray-700 shadow-sm px-6 py-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">PeerTable</h1>
            <p className="text-gray-600 dark:text-gray-400">Welcome, {user?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  New Table
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-700">
                <DialogHeader>
                  <DialogTitle className="dark:text-gray-100">Create New Table</DialogTitle>
                  <DialogDescription className="dark:text-gray-400">
                    Create a new collaborative table that others can join and edit.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Table name"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createTable()}
                    className="bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={createTable} disabled={!newTableName.trim()}>
                      Create
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map((table) => (
            <Card key={table.id} className="relative hover:shadow-md transition-shadow bg-white dark:bg-zinc-800 border border-gray-200 dark:border-gray-700 group">
              <CardHeader>
                <CardTitle className="text-lg text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {table.name}
                </CardTitle>
                <CardDescription className="text-gray-500 dark:text-gray-400">
                  Created {new Date(table.created_at).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button 
                    className="flex-1"
                    onClick={async () => {
                      if (user?.id && user?.email) {
                        // Check if user has a username for this table
                        const { data: userRow, error } = await supabase
                          .from('table_users')
                          .select('id, username')
                          .eq('table_id', table.id)
                          .eq('user_id', user.id)
                          .maybeSingle();
                        if (userRow && typeof userRow === 'object' && 'username' in userRow && userRow.username) {
                          // already has username, do nothing
                        } else if (user?.id && user?.email) {
                          const username = user.email.split('@')[0];
                          if (userRow && 'id' in userRow) {
                            await supabase.from('table_users').update({ username }).eq('id', userRow.id);
                          } else {
                            await supabase.from('table_users').insert({
                              table_id: table.id,
                              user_id: user.id,
                              username,
                              last_seen: new Date().toISOString(),
                            });
                          }
                        }
                      }
                      onSelectTable(table.id, table.name);
                    }}
                  >
                    Open Table
                  </Button>
                  <Button 
                    variant="destructive"
                    size="icon"
                    title="Delete table"
                    onClick={() => { setDeletingTableId(table.id); setShowDeleteDialog(true); }}
                  >
                    <span className="sr-only">Delete</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {tables.length === 0 && (
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">No tables yet</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">Create your first collaborative table to get started.</p>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Table
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-700">
                <DialogHeader>
                  <DialogTitle className="dark:text-gray-100">Create New Table</DialogTitle>
                  <DialogDescription className="dark:text-gray-400">
                    Create a new collaborative table that others can join and edit.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Table name"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createTable()}
                    className="bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={createTable} disabled={!newTableName.trim()}>
                      Create
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* Delete confirmation dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Table</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this table? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => deletingTableId && handleDeleteTable(deletingTableId)}>
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
