
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
        <div className="p-4 bg-white border-b">
          <button 
            onClick={() => setSelectedTable(null)}
            className="text-blue-600 hover:text-blue-800"
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
