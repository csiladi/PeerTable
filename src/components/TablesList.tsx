
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

  const loadTables = async () => {
    try {
      const { data, error } = await supabase
        .from('peer_tables')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTables(data || []);
    } catch (error: any) {
      toast({ title: "Error loading tables", description: error.message, variant: "destructive" });
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
      setNewTableName('');
      setCreateDialogOpen(false);
      toast({ title: "Table created successfully!" });
    } catch (error: any) {
      toast({ title: "Error creating table", description: error.message, variant: "destructive" });
    }
  };

  useEffect(() => {
    loadTables();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">PeerTable</h1>
            <p className="text-gray-600">Welcome, {user?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  New Table
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Table</DialogTitle>
                  <DialogDescription>
                    Create a new collaborative table that others can join and edit.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Table name"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createTable()}
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
            <Card key={table.id} className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-lg">{table.name}</CardTitle>
                <CardDescription>
                  Created {new Date(table.created_at).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  className="w-full" 
                  onClick={() => onSelectTable(table.id, table.name)}
                >
                  Open Table
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {tables.length === 0 && (
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold mb-2">No tables yet</h2>
            <p className="text-gray-600 mb-4">Create your first collaborative table to get started.</p>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Table
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Table</DialogTitle>
                  <DialogDescription>
                    Create a new collaborative table that others can join and edit.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Table name"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createTable()}
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
      </div>
    </div>
  );
};
