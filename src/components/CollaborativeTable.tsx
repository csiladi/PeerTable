import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOfflineStorage } from '@/hooks/useOfflineStorage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Tables } from '@/integrations/supabase/types';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Plus } from 'lucide-react';

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

type TableUserRow = {
  user_id: string;
  last_seen: string;
  username?: string;
  cursor_position?: unknown;
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
  const [userInfo, setUserInfo] = useState<Record<string, { username: string }>>({});
  const [showUserTooltip, setShowUserTooltip] = useState(false);

  // Initialize table with default size - now editable
  const [rows, setRows] = useState(10);
  const [cols, setCols] = useState(5);

  // Ref for scrollable container
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Add column function
  const addColumn = () => {
    preserveScroll(() => setCols(prev => prev + 1));
    toast({ title: "Column added", description: "New column has been added to the table" });
  };

  // Load data from Supabase
  const loadTableData = useCallback(async () => {
    if (!isOnline) {
      const savedCells = offlineData.cells || {};
      const savedPending = offlineData.pendingChanges || {};
      const savedRows = offlineData.rows || 10;
      const savedCols = offlineData.cols || 5;
      setCells(savedCells);
      setPendingChanges(savedPending);
      setRows(savedRows);
      setCols(savedCols);
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

      data?.forEach((item) => {
        const key = getCellKey(item.row_index, item.column_index);
        cellData[key] = {
          row: item.row_index,
          col: item.column_index,
          value: item.value || '',
          version: item.version,
          lastModifiedBy: item.last_modified_by || undefined,
        };
        maxRow = Math.max(maxRow, item.row_index);
        maxCol = Math.max(maxCol, item.column_index);
      });

      // Only grow, never shrink
      if (maxRow + 1 > rows) setRows(maxRow + 1);
      if (maxCol + 1 > cols) setCols(maxCol + 1);
      setCells(cellData);
      saveOfflineData({ ...offlineData, cells: cellData, rows: Math.max(rows, maxRow + 1), cols: Math.max(cols, maxCol + 1) });
    } catch (error: unknown) {
      const err = error as Error;
      toast({ title: "Error loading table", description: err.message, variant: "destructive" });
    }
  }, [tableId, isOnline, offlineData, saveOfflineData, toast, rows, cols]);

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
        // First check if the record already exists
        const { data: existingData, error: checkError } = await supabase
          .from('table_data')
          .select('id, version')
          .eq('table_id', tableId)
          .eq('row_index', row)
          .eq('column_index', col)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
        }

        let upsertError;
        if (existingData) {
          // Record exists, update it
          const { error } = await supabase
            .from('table_data')
            .update({
              value: value,
              last_modified_by: user?.id,
              version: Math.max(newCell.version, existingData.version + 1),
              last_modified_at: new Date().toISOString(),
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
            });
          upsertError = error;
        }

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
    
    console.log('Starting sync of pending changes:', Object.keys(pendingChanges).length);
    
    // Process each pending change sequentially to avoid conflicts
    for (const [key, cell] of Object.entries(pendingChanges)) {
      try {
        // Use the same logic as updateCell for consistency
        const { data: existingData, error: checkError } = await supabase
          .from('table_data')
          .select('id, version')
          .eq('table_id', tableId)
          .eq('row_index', cell.row)
          .eq('column_index', cell.col)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
        }

        let syncError;
        if (existingData) {
          // Record exists, update it with proper version handling
          const { error } = await supabase
            .from('table_data')
            .update({
              value: cell.value,
              last_modified_by: user?.id,
              version: Math.max(cell.version, existingData.version + 1),
              last_modified_at: new Date().toISOString(),
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
            });
          syncError = error;
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
    }, 5000);

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
          .select('user_id, last_seen, cursor_position, username')
          .eq('table_id', tableId);
        if (!error && Array.isArray(data)) {
          // Consider users active if last_seen is within the last 35 seconds
          const now = Date.now();
          const active: string[] = [];
          const selections: Record<string, { row: number; col: number }> = {};
          const info: Record<string, { username: string }> = {};
          data.forEach(row => {
            if (isTableUserRow(row)) {
              const u = row;
              const lastSeen = new Date(u.last_seen).getTime();
              if (now - lastSeen < 35000) {
                const userId = u.user_id;
                const username = u.username;
                active.push(userId);
                info[userId] = { username: username || userId.slice(0, 6) };
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
    }, 15000); // Update every 15 seconds

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

  // Assign a random color to each user for their popup
  const userColors = useMemo(() => {
    const colors = [
      'bg-red-500', 'bg-green-500', 'bg-blue-500', 'bg-yellow-500', 'bg-pink-500',
      'bg-purple-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-cyan-500',
    ];
    const map: Record<string, string> = {};
    let i = 0;
    activeUsers.forEach(uid => {
      if (!map[uid]) {
        map[uid] = colors[i % colors.length];
        i++;
      }
    });
    return map;
  }, [activeUsers]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{tableName}</h1>
        <div className="flex-1 text-center relative">
          {activeUsers.length > 1 ? (
            <span
              className="text-sm text-indigo-700 font-medium bg-indigo-50 rounded px-3 py-1 cursor-pointer"
              onMouseEnter={() => setShowUserTooltip(true)}
              onMouseLeave={() => setShowUserTooltip(false)}
            >
              {activeUsers.length} people are editing this table
              {showUserTooltip && (
                <div className="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 bg-white border border-gray-200 rounded shadow-lg px-4 py-2 text-left min-w-[180px]">
                  <div className="font-semibold text-xs text-gray-500 mb-1">Currently editing:</div>
                  <ul className="text-sm">
                    {activeUsers.filter(uid => uid !== user?.id).map(uid => (
                      <li key={uid} className="py-0.5">
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${userColors[uid]}`}></span>
                        {userInfo[uid]?.username || uid.slice(0, 6)}
                      </li>
                    ))}
                    <li className="py-0.5 text-indigo-700 font-semibold">You</li>
                  </ul>
                </div>
              )}
            </span>
          ) : activeUsers.length === 1 ? (
            <span className="text-sm text-gray-500 font-medium bg-gray-50 rounded px-3 py-1">
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

      {/* Add row/column buttons */}
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
          onClick={addColumn}
          size="sm"
          variant="outline"
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Column
        </Button>
        <Badge variant="secondary" className="ml-2">
          {rows} × {cols}
        </Badge>
      </div>

      <div className="overflow-x-auto" ref={scrollRef}>
        <table className="w-full border-collapse border border-gray-300">
          <thead>
            <tr>
              <th className="border border-gray-300 p-2 bg-gray-100 w-12">#</th>
              {Array.from({ length: cols }, (_, colIndex) => (
                <th key={colIndex} className="border border-gray-300 p-2 bg-gray-100 min-w-32">
                  {String.fromCharCode(65 + colIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, rowIndex) => (
              <tr key={rowIndex}>
                <td className="border border-gray-300 p-2 bg-gray-100 text-center font-medium">
                  {rowIndex + 1}
                </td>
                {Array.from({ length: cols }, (_, colIndex) => {
                  const key = getCellKey(rowIndex, colIndex);
                  const cell = cells[key];
                  const isEditing = editingCell === key;
                  const isPending = key in pendingChanges;
                  // Find if any other user is editing this cell
                  const popups = Object.entries(userSelections)
                    .filter(([uid, selected]) =>
                      uid !== user?.id && selected.row === rowIndex && selected.col === colIndex
                    );
                  return (
                    <td key={colIndex} className={`relative border border-gray-300 p-0 ${isPending ? 'bg-yellow-50' : ''}`}>
                      {/* Popups for other users editing this cell */}
                      {popups.map(([uid]) => (
                        <div
                          key={uid}
                          className="absolute top-0 left-1/2 -translate-x-1/2 mt-1 flex items-center z-10"
                        >
                          <span className={`w-5 h-5 rounded-full ${userColors[uid]} border-2 border-white shadow mr-1`}></span>
                          <span className="text-xs font-semibold bg-white px-2 py-0.5 rounded shadow border border-gray-200">
                            {userInfo[uid]?.username || uid.slice(0, 6)}
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

function isTableUserRow(row: unknown): row is TableUserRow {
  return (
    typeof row === 'object' &&
    row !== null &&
    'user_id' in row && typeof ((row as unknown) as TableUserRow).user_id === 'string' &&
    'last_seen' in row && typeof ((row as unknown) as TableUserRow).last_seen === 'string'
  );
}
