import { useState } from 'react';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { Auth } from '@/components/Auth';
import { TablesList } from '@/components/TablesList';
import { CollaborativeTable } from '@/components/CollaborativeTable';

const AppContent = () => {
  const { user, loading } = useAuth();
  const [selectedTable, setSelectedTable] = useState<{ id: string; name: string } | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  if (selectedTable) {
    return (
      <div>
        <div className="p-4 bg-gray-100 dark:bg-zinc-800 border-b border-gray-200 dark:border-gray-700">
          <button 
            onClick={() => setSelectedTable(null)}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
          >
            ← Back to Tables
          </button>
        </div>
        <CollaborativeTable 
          tableId={selectedTable.id} 
          tableName={selectedTable.name} 
        />
      </div>
    );
  }

  return (
    <TablesList 
      onSelectTable={(id, name) => setSelectedTable({ id, name })} 
    />
  );
};

const Index = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default Index;
