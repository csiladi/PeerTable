import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOfflineStorage } from '@/hooks/useOfflineStorage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Tables } from '@/integrations/supabase/types';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Plus, Minus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/*
@keyframes flash {
  0% { background-color: #dbeafe; }
  100% { background-color: inherit; }
}
.animate-flash {
  animation: flash 1s;
}
*/

interface TableCell {
  row: number;
  col: number;
  value: string;
  version: number;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
}

interface Props {
  tableId: string;
  tableName: string;
}

type TableUserRow = {
  user_id: string;
  last_seen: string;
  username?: string;
  cursor_position?: unknown;
  has_pending?: boolean;
};

type TableHistoryRow = {
  row_index: number;
  column_index: number;
  old_value: string | null;
  new_value: string | null;
  modified_by: string | null;
  modified_at: string;
};

export const CollaborativeTable = ({ tableId, tableName }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: offlineData, saveData: saveOfflineData, isOnline } = useOfflineStorage(`table-${tableId}`);
  
  const [cells, setCells] = useState<Record<string, TableCell>>({});
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [userSelections, setUserSelections] = useState<Record<string, { row: number; col: number }>>({});
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [pendingChanges, setPendingChanges] = useState<Record<string, TableCell>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [userInfo, setUserInfo] = useState<Record<string, { username: string; hasPending?: boolean }>>({});
  const [showUserTooltip, setShowUserTooltip] = useState(false);
  const [lastServerModification, setLastServerModification] = useState<string | null>(null);
  const [lastLocalModification, setLastLocalModification] = useState<string | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [serverCellsSnapshot, setServerCellsSnapshot] = useState<Record<string, TableCell>>({});
  const [recentlySyncedCells, setRecentlySyncedCells] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TableHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Initialize table with default size - now editable
  const [rows, setRows] = useState(10);
  const [cols, setCols] = useState(5);

  // Ref for scrollable container
  const scrollRef = useRef<HTMLDivElement>(null);

  // Always merge cells and pendingChanges for display
  const displayedCells = useMemo(() => {
    return { ...cells, ...pendingChanges };
  }, [cells, pendingChanges]);

  const getCellKey = (row: number, col: number) => `${row}-${col}`;

  // Helper to preserve scroll position
  const preserveScroll = (fn: () => void) => {
    const el = scrollRef.current;
    const scrollLeft = el?.scrollLeft ?? 0;
    const scrollTop = el?.scrollTop ?? 0;
    fn();
    setTimeout(() => {
      if (el) {
        el.scrollLeft = scrollLeft;
        el.scrollTop = scrollTop;
      }
    }, 0);
  };

  // Add row function
  const addRow = () => {
    preserveScroll(() => setRows(prev => prev + 1));
    toast({ title: "Row added", description: "New row has been added to the table" });
  };

  // Remove row function
  const removeRow = () => {
    if (rows > 1) {
      preserveScroll(() => setRows(prev => prev - 1));
      // Remove cells in the last row from state
      const updatedCells = { ...cells };
      const updatedPending = { ...pendingChanges };
      for (let col = 0; col < cols; col++) {
        const key = getCellKey(rows - 1, col);
        delete updatedCells[key];
        delete updatedPending[key];
      }
      setCells(updatedCells);
      setPendingChanges(updatedPending);
      saveOfflineData({
        ...offlineData,
        cells: updatedCells,
        pendingChanges: updatedPending,
        rows: rows - 1,
        cols
      });
      toast({ title: "Row removed", description: "Last row has been removed from the table" });
    }
  };

  // Add column function
  const addColumn = () => {
    preserveScroll(() => setCols(prev => prev + 1));
    toast({ title: "Column added", description: "New column has been added to the table" });
  };

  // Remove column function
  const removeColumn = () => {
    if (cols > 1) {
      preserveScroll(() => setCols(prev => prev - 1));
      // Remove cells in the last column from state
      const updatedCells = { ...cells };
      const updatedPending = { ...pendingChanges };
      for (let row = 0; row < rows; row++) {
        const key = getCellKey(row, cols - 1);
        delete updatedCells[key];
        delete updatedPending[key];
      }
      setCells(updatedCells);
      setPendingChanges(updatedPending);
      saveOfflineData({
        ...offlineData,
        cells: updatedCells,
        pendingChanges: updatedPending,
        rows,
        cols: cols - 1
      });
      toast({ title: "Column removed", description: "Last column has been removed from the table" });
    }
  };

  // Helper to get max last_modified_at from cells
  const getMaxLastModifiedAt = (data: TableCell[]): string | null => {
    if (!data || data.length === 0) return null;
    return data.reduce((max: string, item: TableCell) => {
      if (item.lastModifiedAt && (!max || item.lastModifiedAt > max)) {
        return item.lastModifiedAt;
      }
      return max;
    }, '');
  };

  // Load data from Supabase
  const loadTableData = useCallback(async (forUpdateCheck = false) => {
    if (!isOnline) {
      const savedCells = offlineData.cells || {};
      const savedPending = offlineData.pendingChanges || {};
      console.log('offlineData', offlineData);
      const savedRows = offlineData.rows || 10;
      const savedCols = offlineData.cols || 5;
      setCells(savedCells);
      setPendingChanges(savedPending);
      setRows(savedRows);
      setCols(savedCols);
      // Track last local modification
      let maxLocal: string | null = null;
      if (offlineData.cells) {
        maxLocal = getMaxLastModifiedAt(Object.values(offlineData.cells) as TableCell[]);
      }
      setLastLocalModification(maxLocal);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('table_data')
        .select('*')
        .eq('table_id', tableId);
      if (error) throw error;
      const cellData: Record<string, TableCell> = {};
      let maxRow = rows - 1;
      let maxCol = cols - 1;
      let maxServer: string | null = null;
      data?.forEach((item) => {
        const key = getCellKey(item.row_index, item.column_index);
        cellData[key] = {
          row: item.row_index,
          col: item.column_index,
          value: item.value || '',
          version: item.version,
          lastModifiedBy: item.last_modified_by || undefined,
          lastModifiedAt: item.last_modified_at,
        };
        maxRow = Math.max(maxRow, item.row_index);
        maxCol = Math.max(maxCol, item.column_index);
        if (item.last_modified_at && (!maxServer || item.last_modified_at > maxServer)) {
          maxServer = item.last_modified_at;
        }
      });
      setLastServerModification(maxServer);
      setServerCellsSnapshot(cellData);
      // Only grow, never shrink
      if (maxRow + 1 > rows) setRows(maxRow + 1);
      if (maxCol + 1 > cols) setCols(maxCol + 1);
      setCells(cellData);
      setRows(Math.max(rows, maxRow + 1));
      setCols(Math.max(cols, maxCol + 1));
      // If this is for update check, don't overwrite local state
      if (forUpdateCheck) return { maxServer, cellData };
    } catch (error: unknown) {
      const err = error as Error;
      toast({ title: "Error loading table", description: err.message, variant: "destructive" });
    }
  }, [tableId, isOnline, offlineData, toast, rows, cols]);

  // Helper to log a cell change to table_history
  const logCellHistory = async (row: number, col: number, oldValue: string | null, newValue: string, modifiedBy: string | null, modifiedAt: string) => {
    try {
      await supabase.from('table_history').insert({
        table_id: tableId,
        row_index: row,
        column_index: col,
        old_value: oldValue,
        new_value: newValue,
        modified_by: modifiedBy,
        modified_at: modifiedAt,
      });
    } catch (err) {
      console.error('Error logging table history:', err);
    }
  };

  // Update cell value
  const updateCell = async (row: number, col: number, value: string) => {
    const key = getCellKey(row, col);
    const currentCellValue = cells[key]?.value || '';
    const newCell: TableCell = {
      row,
      col,
      value,
      version: (cells[key]?.version || 0) + 1,
      lastModifiedBy: user?.id,
      lastModifiedAt: new Date().toISOString(),
    };

    // Update local state immediately (optimistic update)
    setCells(prev => ({ ...prev, [key]: newCell }));
    
    if (isOnline) {
      try {
        // First check if the record already exists
        const { data: existingData, error: checkError } = await supabase
          .from('table_data')
          .select('id, version, value')
          .eq('table_id', tableId)
          .eq('row_index', row)
          .eq('column_index', col)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
        }

        let upsertError;
        const oldValue = existingData ? existingData.value : null;
        if (existingData) {
          // Record exists, update it
          const { error } = await supabase
            .from('table_data')
            .update({
              value: value,
              last_modified_by: user?.id,
              version: Math.max(newCell.version, existingData.version + 1),
              last_modified_at: newCell.lastModifiedAt,
            })
            .eq('id', existingData.id);
          upsertError = error;
        } else {
          // Record doesn't exist, insert it
          const { error } = await supabase
            .from('table_data')
            .insert({
              table_id: tableId,
              row_index: row,
              column_index: col,
              value: value,
              last_modified_by: user?.id,
              version: newCell.version,
              last_modified_at: newCell.lastModifiedAt,
            });
          upsertError = error;
        }

        // Log to table_history
        await logCellHistory(row, col, oldValue, value, user?.id || null, newCell.lastModifiedAt!);

        if (upsertError) {
          throw upsertError;
        }
        
        // Online update successful - remove from pending changes if it was there
        const newPendingChanges = { ...pendingChanges };
        delete newPendingChanges[key];
        setPendingChanges(newPendingChanges);
        
        // Save to offline storage after successful online update
        const updatedCells = { ...cells, [key]: newCell };
        saveOfflineData({ 
          ...offlineData, 
          cells: updatedCells,
          pendingChanges: newPendingChanges,
          rows,
          cols
        });
      } catch (error: unknown) {
        console.error('Error saving to Supabase:', error);
        // If online update fails, store as pending change
        const newPendingChanges = { ...pendingChanges, [key]: newCell };
        setPendingChanges(newPendingChanges);
        
        // Save both cells and pending changes to offline storage
        const updatedCells = { ...cells, [key]: newCell };
        saveOfflineData({ 
          ...offlineData, 
          cells: updatedCells,
          pendingChanges: newPendingChanges,
          rows,
          cols
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
        pendingChanges: newPendingChanges,
        rows,
        cols
      });
    }
  };

  // Handle cell editing start
  const startEditing = async (row: number, col: number) => {
    const key = getCellKey(row, col);
    const currentValue = cells[key]?.value || '';
    setEditingCell(key);
    setEditingValue(currentValue);
    // Broadcast selected cell to Supabase
    if (isOnline && user) {
      try {
        await supabase
          .from('table_users')
          .update({ cursor_position: { selectedCell: { row, col } } })
          .eq('table_id', tableId)
          .eq('user_id', user.id);
      } catch (e) {
        // ignore
      }
    }
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
    // Clear selected cell
    if (isOnline && user) {
      try {
        await supabase
          .from('table_users')
          .update({ cursor_position: null })
          .eq('table_id', tableId)
          .eq('user_id', user.id);
      } catch (e) {
        // ignore
      }
    }
  };

  // Handle escape key
  const cancelEditing = () => {
    setEditingCell(null);
    setEditingValue('');
    // Clear selected cell
    if (isOnline && user) {
      supabase
        .from('table_users')
        .update({ cursor_position: null })
        .eq('table_id', tableId)
        .eq('user_id', user.id);
    }
  };

  // Sync pending changes when back online
  const syncPendingChanges = useCallback(async () => {
    if (!isOnline || Object.keys(pendingChanges).length === 0 || isSyncing) return;
    
    setIsSyncing(true);
    let syncedCount = 0;
    let failedCount = 0;
    const remainingPendingChanges: Record<string, TableCell> = {};
    const updatedCellKeys: string[] = [];
    
    console.log('Starting sync of pending changes:', Object.keys(pendingChanges).length);
    
    // Process each pending change sequentially to avoid conflicts
    for (const [key, cell] of Object.entries(pendingChanges)) {
      try {
        // Fetch the server's last_modified_at for this cell
        const { data: existingData, error: checkError } = await supabase
          .from('table_data')
          .select('id, version, last_modified_at, value')
          .eq('table_id', tableId)
          .eq('row_index', cell.row)
          .eq('column_index', cell.col)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
        }

        let syncError;
        let shouldUpdate = true;
        if (existingData) {
          // Compare timestamps
          const serverTime = existingData.last_modified_at ? new Date(existingData.last_modified_at).getTime() : 0;
          const localTime = cell.lastModifiedAt ? new Date(cell.lastModifiedAt).getTime() : 0;
          if (serverTime > localTime) {
            // Server is newer, skip update and remove from pending
            shouldUpdate = false;
            syncedCount++;
          }
        }
        if (shouldUpdate) {
          if (existingData) {
            // Record exists, update it with proper version handling
            const { error } = await supabase
              .from('table_data')
              .update({
                value: cell.value,
                last_modified_by: user?.id,
                version: Math.max(cell.version, existingData.version + 1),
                last_modified_at: cell.lastModifiedAt || new Date().toISOString(),
              })
              .eq('id', existingData.id);
            syncError = error;
          } else {
            // Record doesn't exist, insert it
            const { error } = await supabase
              .from('table_data')
              .insert({
                table_id: tableId,
                row_index: cell.row,
                column_index: cell.col,
                value: cell.value,
                last_modified_by: user?.id,
                version: cell.version,
                last_modified_at: cell.lastModifiedAt || new Date().toISOString(),
              });
            syncError = error;
          }
          // Mark this cell as recently updated
          updatedCellKeys.push(key);
          // Log to table_history (sync context: old value is server value, new value is cell.value)
          const oldValue = existingData ? existingData.value : null;
          await logCellHistory(cell.row, cell.col, oldValue, cell.value, user?.id || null, cell.lastModifiedAt || new Date().toISOString());
        }

        if (syncError) {
          console.error('Error syncing cell:', key, syncError);
          // Only keep as pending if it's not a duplicate key error
          if (!syncError.message?.includes('duplicate key')) {
            remainingPendingChanges[key] = cell;
            failedCount++;
          } else {
            // For duplicate key errors, consider it synced (data is already there)
            console.log('Cell already synced (duplicate key):', key);
            syncedCount++;
          }
        } else {
          console.log('Successfully synced cell:', key);
          syncedCount++;
        }
        // Add small delay between operations to prevent overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error: unknown) {
        console.error('Exception syncing cell:', key, error);
        // Don't keep retrying if it's a duplicate key constraint
        if (!(error instanceof Error) || !error.message?.includes('duplicate key')) {
          remainingPendingChanges[key] = cell;
          failedCount++;
        } else {
          console.log('Cell already exists (skipping):', key);
          syncedCount++;
        }
      }
    }
    // Flash updated cells
    if (updatedCellKeys.length > 0) {
      setRecentlySyncedCells(prev => {
        const newSet = new Set(prev);
        updatedCellKeys.forEach(k => newSet.add(k));
        return newSet;
      });
      setTimeout(() => {
        setRecentlySyncedCells(prev => {
          const newSet = new Set(prev);
          updatedCellKeys.forEach(k => newSet.delete(k));
          return newSet;
        });
      }, 1000); // 1s flash
    }
    // Update pending changes with only the truly failed ones
    setPendingChanges(remainingPendingChanges);
    
    // After sync, reload the table data to get the latest state from database
    if (syncedCount > 0) {
      await loadTableData();
    }
    
    // Update offline storage
    saveOfflineData({ 
      ...offlineData, 
      cells: cells,
      pendingChanges: remainingPendingChanges,
      rows,
      cols
    });
    
    // Show appropriate toast messages
    if (failedCount === 0 && syncedCount > 0) {
      toast({ 
        title: "Changes synced", 
        description: `${syncedCount} offline changes have been synced successfully` 
      });
    } else if (failedCount > 0) {
      toast({ 
        title: "Partial sync", 
        description: `${syncedCount} changes synced, ${failedCount} failed. Will retry.`,
        variant: "destructive"
      });
    }
    
    setIsSyncing(false);
  }, [isOnline, pendingChanges, tableId, user?.id, toast, cells, offlineData, saveOfflineData, isSyncing, loadTableData, rows, cols]);

  // Sync pending changes when coming online and every 5 seconds if there are pending changes
  useEffect(() => {
    if (!isOnline) return;

    // Sync immediately when coming online
    if (Object.keys(pendingChanges).length > 0) {
      const timeoutId = setTimeout(syncPendingChanges, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [isOnline, pendingChanges, syncPendingChanges]);

  // Periodic check for pending changes every 5 seconds
  useEffect(() => {
    if (!isOnline || Object.keys(pendingChanges).length === 0) return;

    const interval = setInterval(() => {
      if (Object.keys(pendingChanges).length > 0 && !isSyncing) {
        console.log('Periodic check: syncing pending changes');
        syncPendingChanges();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isOnline, pendingChanges, isSyncing, syncPendingChanges]);

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
              // Flash this cell as recently updated by another user
              setRecentlySyncedCells(prev => {
                const newSet = new Set(prev);
                newSet.add(key);
                return newSet;
              });
              setTimeout(() => {
                setRecentlySyncedCells(prev => {
                  const newSet = new Set(prev);
                  newSet.delete(key);
                  return newSet;
                });
              }, 1000); // 1s flash
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

  // Track user presence with improved error handling
  useEffect(() => {
    if (!isOnline || !user) return;

    const trackPresence = async () => {
      try {
        // First try to update existing record
        const { data, error: updateError } = await supabase
          .from('table_users')
          .update({
            last_seen: new Date().toISOString(),
          })
          .eq('table_id', tableId)
          .eq('user_id', user.id)
          .select();

        // If no rows were updated, insert a new record
        if (!updateError && (!data || data.length === 0)) {
          const { error: insertError } = await supabase
            .from('table_users')
            .insert({
              table_id: tableId,
              user_id: user.id,
              last_seen: new Date().toISOString(),
            });

          // Ignore duplicate key errors as they mean the record already exists
          if (insertError && !insertError.message?.includes('duplicate key')) {
            console.error('Error inserting user presence:', insertError);
          }
        } else if (updateError) {
          console.error('Error updating user presence:', updateError);
        }
      } catch (error) {
        console.error('Error in trackPresence:', error);
      }
    };

    // Fetch all online users for this table
    const fetchActiveUsers = async () => {
      try {
        const { data, error } = await supabase
          .from('table_users')
          .select('user_id, last_seen, cursor_position, username, has_pending')
          .eq('table_id', tableId);
        if (!error && Array.isArray(data)) {
          // Consider users active if last_seen is within the last 35 seconds
          const now = Date.now();
          const active: string[] = [];
          const selections: Record<string, { row: number; col: number }> = {};
          const info: Record<string, { username: string; hasPending?: boolean }> = {};
          data.forEach(row => {
            if (isTableUserRow(row)) {
              const u = row;
              const lastSeen = new Date(u.last_seen).getTime();
              if (now - lastSeen < 35000) {
                const userId = u.user_id;
                const username = u.username;
                active.push(userId);
                info[userId] = { username: username || userId.slice(0, 6), hasPending: !!(u as TableUserRow).has_pending };
                // Type guard for cursor_position
                function isSelectedCell(pos: unknown): pos is { selectedCell: { row: number; col: number } } {
                  return (
                    typeof pos === 'object' &&
                    pos !== null &&
                    !Array.isArray(pos) &&
                    typeof (pos as { selectedCell?: unknown }).selectedCell === 'object' &&
                    (pos as { selectedCell?: unknown }).selectedCell !== null &&
                    typeof (pos as { selectedCell: { row?: unknown; col?: unknown } }).selectedCell.row === 'number' &&
                    typeof (pos as { selectedCell: { row?: unknown; col?: unknown } }).selectedCell.col === 'number'
                  );
                }
                const pos = u.cursor_position;
                if (isSelectedCell(pos)) {
                  selections[userId] = pos.selectedCell;
                }
              }
            }
          });
          setActiveUsers(active);
          setUserSelections(selections);
          setUserInfo(info);
        }
      } catch (error) {
        console.error('Error fetching active users:', error);
      }
    };

    trackPresence();
    fetchActiveUsers();
    const presenceInterval = setInterval(() => {
      trackPresence();
      fetchActiveUsers();
    }, 5000); // Update every 15 seconds

    // Subscribe to realtime changes in table_users
    const channel = supabase
      .channel(`table-users-${tableId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'table_users',
          filter: `table_id=eq.${tableId}`,
        },
        (payload) => {
          fetchActiveUsers();
        }
      )
      .subscribe();

    return () => {
      clearInterval(presenceInterval);
      supabase.removeChannel(channel);
    };
  }, [tableId, user, isOnline]);

  // Helper to ensure a table_users row exists for the current user
  const ensureUserRow = async () => {
    if (!user) return;
    try {
      // Try to update last_seen (if row exists)
      const { data, error: updateError } = await supabase
        .from('table_users')
        .update({ last_seen: new Date().toISOString() })
        .eq('table_id', tableId)
        .eq('user_id', user.id)
        .select();
      // If no row, insert
      if (!updateError && (!data || data.length === 0)) {
        const { error: insertError } = await supabase
          .from('table_users')
          .insert({
            table_id: tableId,
            user_id: user.id,
            last_seen: new Date().toISOString(),
          });
        if (insertError && !insertError.message?.includes('duplicate key')) {
          console.error('Error inserting user row for has_pending:', insertError);
        }
      } else if (updateError) {
        console.error('Error updating user row for has_pending:', updateError);
      }
    } catch (err) {
      console.error('Exception in ensureUserRow:', err);
    }
  };

  // Broadcast has_pending to other users when pendingChanges changes
  useEffect(() => {
    if (!isOnline || !user) return;
    const hasPending = Object.keys(pendingChanges).length > 0;
    (async () => {
      await ensureUserRow();
      const { error } = await supabase
        .from('table_users')
        .update({ has_pending: hasPending })
        .eq('table_id', tableId)
        .eq('user_id', user.id);
      if (error) {
        console.error('Error updating has_pending:', error);
      }
    })();
  }, [pendingChanges, isOnline, user, tableId]);

  // Also update has_pending when coming back online if there are pending changes
  useEffect(() => {
    if (!isOnline || !user) return;
    if (Object.keys(pendingChanges).length === 0) return;
    (async () => {
      await ensureUserRow();
      const { error } = await supabase
        .from('table_users')
        .update({ has_pending: true })
        .eq('table_id', tableId)
        .eq('user_id', user.id);
      if (error) {
        console.error('Error updating has_pending (online effect):', error);
      }
    })();
  }, [isOnline, user, tableId, pendingChanges]);

  // Assign a consistent color to each user based on their user_id
  const userColors = useMemo(() => {
    const colors = [
      'bg-red-500', 'bg-green-500', 'bg-blue-500', 'bg-yellow-500', 'bg-pink-500',
      'bg-purple-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-cyan-500',
    ];
    // Simple hash function for user_id
    function hashString(str: string) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
      }
      return Math.abs(hash);
    }
    const map: Record<string, string> = {};
    activeUsers.forEach(uid => {
      map[uid] = colors[hashString(uid) % colors.length];
    });
    return map;
  }, [activeUsers]);

  // Ref for debouncing offline storage writes
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  // Debounced persist to offline storage
  useEffect(() => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }
    saveTimeout.current = setTimeout(() => {
      saveOfflineData({
        ...offlineData,
        cells, // keep server state
        pendingChanges,
        rows,
        cols,
      });
    }, 400); // 400ms debounce
    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChanges, cells, rows, cols]);

  // Persist on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveOfflineData({
        ...offlineData,
        cells,
        pendingChanges,
        rows,
        cols,
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChanges, cells, rows, cols, offlineData]);

  // When coming back online, check for server changes
  useEffect(() => {
    if (!isOnline) return;
    let didShow = false;
    const checkForServerUpdates = async () => {
      // Only check if we have local offline data
      if (!offlineData.cells || Object.keys(offlineData.cells).length === 0) return;
      // Get last local modification
      let maxLocal: string | null = null;
      if (offlineData.cells) {
        maxLocal = getMaxLastModifiedAt(Object.values(offlineData.cells) as TableCell[]);
      }
      setLastLocalModification(maxLocal);
      // Fetch server data for update check
      const { maxServer, cellData } = await loadTableData(true) || {};
      setLastServerModification(maxServer);
      // If server has newer data, update and show toast
      if (maxServer && maxLocal && maxServer > maxLocal && !didShow) {
        setCells(cellData || {});
        toast({ title: "Table updated", description: "Table was updated with the latest server data while you were offline." });
        didShow = true;
      }
    };
    checkForServerUpdates();
    // Only run once when coming online
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const fetchTableHistory = async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
        .from('table_history')
        .select('row_index, column_index, old_value, new_value, modified_by, modified_at')
        .eq('table_id', tableId)
        .order('modified_at', { ascending: false });
      if (error) throw error;
      setHistory((data as TableHistoryRow[]) || []);
    } catch (err: unknown) {
      setHistoryError((err instanceof Error && err.message) ? err.message : 'Error fetching history');
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{tableName}</h1>
        <div className="flex-1 text-center relative">
          {activeUsers.length > 1 ? (
            <span
              className="text-sm text-indigo-700 font-medium bg-indigo-50 dark:bg-indigo-900/10 dark:text-indigo-400 rounded px-3 py-1 cursor-pointer"
              onMouseEnter={() => setShowUserTooltip(true)}
              onMouseLeave={() => setShowUserTooltip(false)}
            >
              {activeUsers.length} people are editing this table
              {showUserTooltip && (
                <div className="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-700 rounded shadow-lg px-4 py-2 text-left min-w-[180px]">
                  <div className="font-semibold text-xs text-gray-500 dark:text-gray-400 mb-1">Currently editing:</div>
                  <ul className="text-sm">
                    {activeUsers.filter(uid => uid !== user?.id).map(uid => (
                      <li key={uid} className="py-0.5 flex items-center">
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${userColors[uid]}`}></span>
                        {userInfo[uid]?.username || uid.slice(0, 6)}
                        {userInfo[uid]?.hasPending && (
                          <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/10 rounded px-1 py-0.5">offline changes</span>
                        )}
                      </li>
                    ))}
                    <li className="py-0.5 text-indigo-700 dark:text-indigo-400 font-semibold">You</li>
                  </ul>
                </div>
              )}
            </span>
          ) : activeUsers.length === 1 ? (
            <span className="text-sm text-gray-500 font-medium bg-gray-50 dark:bg-zinc-800 rounded px-3 py-1">
              You are editing this table
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isOnline ? "default" : "secondary"}>
            {isOnline ? "Online" : "Offline"}
          </Badge>
          {Object.keys(pendingChanges).length > 0 && (
            <>
              <Badge variant="outline">
                {Object.keys(pendingChanges).length} pending
              </Badge>
              {isOnline && (
                <Button
                  onClick={syncPendingChanges}
                  disabled={isSyncing}
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync'}
                </Button>
              )}
            </>
          )}
          {isSyncing && (
            <Badge variant="secondary">
              Syncing...
            </Badge>
          )}
        </div>
      </div>

      {/* Add/remove row/column buttons and Table History */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          onClick={addRow}
          size="sm"
          variant="outline"
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Row
        </Button>
        <Button
          onClick={removeRow}
          size="sm"
          variant="outline"
          className="flex items-center gap-2"
          disabled={rows <= 1}
        >
          <Minus className="h-4 w-4" />
          Remove Row
        </Button>
        <Button
          onClick={addColumn}
          size="sm"
          variant="outline"
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Column
        </Button>
        <Button
          onClick={removeColumn}
          size="sm"
          variant="outline"
          className="flex items-center gap-2"
          disabled={cols <= 1}
        >
          <Minus className="h-4 w-4" />
          Remove Column
        </Button>
        <Badge variant="secondary" className="ml-2">
          {rows} × {cols}
        </Badge>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => { setShowHistory(true); fetchTableHistory(); }}>
          Table History
        </Button>
      </div>

      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-2xl bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle>Table History</DialogTitle>
            <DialogDescription>
              All cell modifications for this table (most recent first)
            </DialogDescription>
          </DialogHeader>
          {loadingHistory ? (
            <div className="py-8 text-center">Loading...</div>
          ) : historyError ? (
            <div className="py-8 text-center text-red-500">{historyError}</div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-gray-500">No history yet.</div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="min-w-full text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900">
                <thead>
                  <tr className="bg-gray-100 dark:bg-zinc-800">
                    <th className="p-2 border border-gray-200 dark:border-gray-700">Cell</th>
                    <th className="p-2 border border-gray-200 dark:border-gray-700">Old Value</th>
                    <th className="p-2 border border-gray-200 dark:border-gray-700">New Value</th>
                    <th className="p-2 border border-gray-200 dark:border-gray-700">Modified By</th>
                    <th className="p-2 border border-gray-200 dark:border-gray-700">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-gray-50 dark:bg-zinc-800'}>
                      <td className="p-2 border border-gray-200 dark:border-gray-700 font-mono">{String.fromCharCode(65 + h.column_index)}{h.row_index + 1}</td>
                      <td className="p-2 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">{h.old_value ?? <span className="italic">(empty)</span>}</td>
                      <td className="p-2 border border-gray-200 dark:border-gray-700">{h.new_value ?? <span className="italic">(empty)</span>}</td>
                      <td className="p-2 border border-gray-200 dark:border-gray-700">{h.modified_by ? (userInfo[h.modified_by]?.username || h.modified_by.slice(0, 6)) : <span className="italic">unknown</span>}</td>
                      <td className="p-2 border border-gray-200 dark:border-gray-700 whitespace-nowrap">{new Date(h.modified_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto" ref={scrollRef}>
        <table className="w-full border-collapse border border-gray-300 dark:border-gray-700 bg-white dark:bg-zinc-900 rounded-lg shadow-sm">
          <thead>
            <tr>
              <th className="border border-gray-300 dark:border-gray-700 p-2 bg-gray-100 dark:bg-zinc-800 w-12 text-gray-700 dark:text-gray-200">#</th>
              {Array.from({ length: cols }, (_, colIndex) => (
                <th key={colIndex} className="border border-gray-300 dark:border-gray-700 p-2 bg-gray-100 dark:bg-zinc-800 min-w-32 text-gray-700 dark:text-gray-200">
                  {String.fromCharCode(65 + colIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, rowIndex) => (
              <tr key={rowIndex}>
                <td className="border border-gray-300 dark:border-gray-700 p-2 bg-gray-100 dark:bg-zinc-800 text-center font-medium text-gray-700 dark:text-gray-200">
                  {rowIndex + 1}
                </td>
                {Array.from({ length: cols }, (_, colIndex) => {
                  const key = getCellKey(rowIndex, colIndex);
                  const cell = displayedCells[key];
                  const isEditing = editingCell === key;
                  const isPending = key in pendingChanges;
                  const isRecentlySynced = recentlySyncedCells.has(key);
                  // Find if any other user is editing this cell
                  const popups = Object.entries(userSelections)
                    .filter(([uid, selected]) =>
                      uid !== user?.id && selected.row === rowIndex && selected.col === colIndex
                    );
                  return (
                    <td key={colIndex} className={`relative border border-gray-300 dark:border-gray-700 p-0 transition-colors duration-200 ${isPending ? 'bg-yellow-50 dark:bg-yellow-900/30' : ''} ${isRecentlySynced ? 'bg-blue-100 dark:bg-blue-900/40 animate-flash' : ''}`}>
                      {/* Popups for other users editing this cell */}
                      {popups.map(([uid]) => (
                        <div
                          key={uid}
                          className="absolute top-1/2 right-1 -translate-y-1/2 z-10 flex items-center"
                          style={{ pointerEvents: 'none' }}
                        >
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold shadow border border-gray-200 dark:border-gray-700 flex items-center gap-1 ${userColors[uid]} text-white`}
                            style={{ minWidth: 32, maxWidth: 120, whiteSpace: 'nowrap' }}
                          >
                            {userInfo[uid]?.username ? userInfo[uid]?.username : uid.slice(0, 6)}
                            {/* Optional: Animated typing dots */}
                            <span className="ml-1 inline-block align-middle">
                              <span className="inline-block w-1 h-1 bg-white/80 rounded-full animate-bounce [animation-delay:0s]"></span>
                              <span className="inline-block w-1 h-1 bg-white/80 rounded-full mx-0.5 animate-bounce [animation-delay:0.15s]"></span>
                              <span className="inline-block w-1 h-1 bg-white/80 rounded-full animate-bounce [animation-delay:0.3s]"></span>
                            </span>
                          </span>
                        </div>
                      ))}
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
                          className="border-0 h-8 focus:ring-0 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100"
                          autoFocus
                        />
                      ) : (
                        <div
                          className="min-h-8 p-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800/70 transition-colors duration-150 text-gray-900 dark:text-gray-100"
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

function isTableUserRow(row: unknown): row is TableUserRow {
  return (
    typeof row === 'object' &&
    row !== null &&
    'user_id' in row && typeof ((row as unknown) as TableUserRow).user_id === 'string' &&
    'last_seen' in row && typeof ((row as unknown) as TableUserRow).last_seen === 'string'
  );
}
