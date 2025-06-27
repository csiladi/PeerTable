
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOfflineStorage } from '@/hooks/useOfflineStorage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Tables } from '@/integrations/supabase/types';
import { Badge } from '@/components/ui/badge';

interface TableCell {
  row: number;
  col: number;
  value: string;
  version: number;
  lastModifiedBy?: string;
}

interface Props {
  tableId: string;
  tableName: string;
}

export const CollaborativeTable = ({ tableId, tableName }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: offlineData, saveData: saveOfflineData, isOnline } = useOfflineStorage(`table-${tableId}`);
  
  const [cells, setCells] = useState<Record<string, TableCell>>({});
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [pendingChanges, setPendingChanges] = useState<Record<string, TableCell>>({});
  const [isSyncing, setIsSyncing] = useState(false);

  // Initialize table with default size
  const ROWS = 10;
  const COLS = 5;

  const getCellKey = (row: number, col: number) => `${row}-${col}`;

  // Load data from Supabase
  const loadTableData = useCallback(async () => {
    if (!isOnline) {
      const savedCells = offlineData.cells || {};
      const savedPending = offlineData.pendingChanges || {};
      setCells(savedCells);
      setPendingChanges(savedPending);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('table_data')
        .select('*')
        .eq('table_id', tableId);

      if (error) throw error;

      const cellData: Record<string, TableCell> = {};
      data?.forEach((item) => {
        const key = getCellKey(item.row_index, item.column_index);
        cellData[key] = {
          row: item.row_index,
          col: item.column_index,
          value: item.value || '',
          version: item.version,
          lastModifiedBy: item.last_modified_by || undefined,
        };
      });

      setCells(cellData);
      saveOfflineData({ ...offlineData, cells: cellData });
    } catch (error: any) {
      toast({ title: "Error loading table", description: error.message, variant: "destructive" });
    }
  }, [tableId, isOnline, offlineData, saveOfflineData, toast]);

  // Update cell value
  const updateCell = async (row: number, col: number, value: string) => {
    const key = getCellKey(row, col);
    const newCell: TableCell = {
      row,
      col,
      value,
      version: (cells[key]?.version || 0) + 1,
      lastModifiedBy: user?.id,
    };

    // Update local state immediately (optimistic update)
    setCells(prev => ({ ...prev, [key]: newCell }));
    
    if (isOnline) {
      try {
        const { error } = await supabase
          .from('table_data')
          .upsert({
            table_id: tableId,
            row_index: row,
            column_index: col,
            value: value,
            last_modified_by: user?.id,
            version: newCell.version,
          });

        if (error) throw error;
        
        // Save to offline storage after successful online update
        const updatedCells = { ...cells, [key]: newCell };
        saveOfflineData({ 
          ...offlineData, 
          cells: updatedCells,
          pendingChanges: { ...pendingChanges }
        });
      } catch (error: any) {
        console.error('Error saving to Supabase:', error);
        // If online update fails, store as pending change
        const newPendingChanges = { ...pendingChanges, [key]: newCell };
        setPendingChanges(newPendingChanges);
        
        // Save both cells and pending changes to offline storage
        const updatedCells = { ...cells, [key]: newCell };
        saveOfflineData({ 
          ...offlineData, 
          cells: updatedCells,
          pendingChanges: newPendingChanges
        });
        
        toast({ title: "Saved offline", description: "Will sync when connection is restored" });
      }
    } else {
      // Store as pending change when offline
      const newPendingChanges = { ...pendingChanges, [key]: newCell };
      setPendingChanges(newPendingChanges);
      
      // Save both cells and pending changes to offline storage
      const updatedCells = { ...cells, [key]: newCell };
      saveOfflineData({ 
        ...offlineData, 
        cells: updatedCells,
        pendingChanges: newPendingChanges
      });
    }
  };

  // Handle cell editing start
  const startEditing = (row: number, col: number) => {
    const key = getCellKey(row, col);
    const currentValue = cells[key]?.value || '';
    setEditingCell(key);
    setEditingValue(currentValue);
  };

  // Handle cell editing finish
  const finishEditing = async () => {
    if (!editingCell) return;
    
    const [row, col] = editingCell.split('-').map(Number);
    const currentCellValue = cells[editingCell]?.value || '';
    
    // Only update if the value has actually changed
    if (editingValue !== currentCellValue) {
      await updateCell(row, col, editingValue);
    }
    
    setEditingCell(null);
    setEditingValue('');
  };

  // Handle escape key
  const cancelEditing = () => {
    setEditingCell(null);
    setEditingValue('');
  };

  // Sync pending changes when back online
  useEffect(() => {
    const syncPendingChanges = async () => {
      if (!isOnline || Object.keys(pendingChanges).length === 0 || isSyncing) return;
      
      setIsSyncing(true);
      let syncedCount = 0;
      let failedCount = 0;
      
      console.log('Starting sync of pending changes:', Object.keys(pendingChanges).length);
      
      for (const [key, cell] of Object.entries(pendingChanges)) {
        try {
          const { error } = await supabase
            .from('table_data')
            .upsert({
              table_id: tableId,
              row_index: cell.row,
              column_index: cell.col,
              value: cell.value,
              last_modified_by: user?.id,
              version: cell.version,
            });

          if (error) {
            console.error('Error syncing cell:', key, error);
            failedCount++;
          } else {
            console.log('Successfully synced cell:', key);
            syncedCount++;
          }
        } catch (error) {
          console.error('Exception syncing cell:', key, error);
          failedCount++;
        }
      }
      
      if (failedCount === 0) {
        // All changes synced successfully, clear pending changes
        setPendingChanges({});
        saveOfflineData({ 
          ...offlineData, 
          cells: cells,
          pendingChanges: {}
        });
        
        if (syncedCount > 0) {
          toast({ 
            title: "Changes synced", 
            description: `${syncedCount} offline changes have been synced successfully` 
          });
        }
      } else {
        toast({ 
          title: "Partial sync", 
          description: `${syncedCount} changes synced, ${failedCount} failed. Will retry.`,
          variant: "destructive"
        });
      }
      
      setIsSyncing(false);
    };

    syncPendingChanges();
  }, [isOnline, pendingChanges, tableId, user?.id, toast, cells, offlineData, saveOfflineData, isSyncing]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!isOnline) return;

    const channel = supabase
      .channel(`table-${tableId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'table_data',
          filter: `table_id=eq.${tableId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const data = payload.new as Tables<'table_data'>;
            const key = getCellKey(data.row_index, data.column_index);
            
            // Only update if it's not our own change and we're not currently editing this cell
            if (data.last_modified_by !== user?.id && editingCell !== key) {
              setCells(prev => ({
                ...prev,
                [key]: {
                  row: data.row_index,
                  col: data.column_index,
                  value: data.value || '',
                  version: data.version,
                  lastModifiedBy: data.last_modified_by || undefined,
                }
              }));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableId, user?.id, isOnline, editingCell]);

  // Load initial data
  useEffect(() => {
    loadTableData();
  }, [loadTableData]);

  // Track user presence
  useEffect(() => {
    if (!isOnline || !user) return;

    const trackPresence = async () => {
      await supabase
        .from('table_users')
        .upsert({
          table_id: tableId,
          user_id: user.id,
          last_seen: new Date().toISOString(),
        });
    };

    trackPresence();
    const interval = setInterval(trackPresence, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [tableId, user, isOnline]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{tableName}</h1>
        <div className="flex items-center gap-2">
          <Badge variant={isOnline ? "default" : "secondary"}>
            {isOnline ? "Online" : "Offline"}
          </Badge>
          {Object.keys(pendingChanges).length > 0 && (
            <Badge variant="outline">
              {Object.keys(pendingChanges).length} pending
            </Badge>
          )}
          {isSyncing && (
            <Badge variant="secondary">
              Syncing...
            </Badge>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-gray-300">
          <thead>
            <tr>
              <th className="border border-gray-300 p-2 bg-gray-100 w-12">#</th>
              {Array.from({ length: COLS }, (_, colIndex) => (
                <th key={colIndex} className="border border-gray-300 p-2 bg-gray-100 min-w-32">
                  {String.fromCharCode(65 + colIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, rowIndex) => (
              <tr key={rowIndex}>
                <td className="border border-gray-300 p-2 bg-gray-100 text-center font-medium">
                  {rowIndex + 1}
                </td>
                {Array.from({ length: COLS }, (_, colIndex) => {
                  const key = getCellKey(rowIndex, colIndex);
                  const cell = cells[key];
                  const isEditing = editingCell === key;
                  const isPending = key in pendingChanges;
                  
                  return (
                    <td key={colIndex} className={`border border-gray-300 p-0 ${isPending ? 'bg-yellow-50' : ''}`}>
                      {isEditing ? (
                        <Input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={finishEditing}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              finishEditing();
                            }
                            if (e.key === 'Escape') {
                              cancelEditing();
                            }
                          }}
                          className="border-0 h-8 focus:ring-0"
                          autoFocus
                        />
                      ) : (
                        <div
                          className="min-h-8 p-2 cursor-pointer hover:bg-gray-50"
                          onClick={() => startEditing(rowIndex, colIndex)}
                        >
                          {cell?.value || ''}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
