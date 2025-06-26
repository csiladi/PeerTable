
import { useState, useEffect } from 'react';

interface OfflineData {
  [key: string]: any;
}

export const useOfflineStorage = (key: string) => {
  const [data, setData] = useState<OfflineData>({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Load data from localStorage on mount
    const storedData = localStorage.getItem(key);
    if (storedData) {
      try {
        setData(JSON.parse(storedData));
      } catch (error) {
        console.error('Error parsing stored data:', error);
      }
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [key]);

  const saveData = (newData: OfflineData) => {
    setData(newData);
    localStorage.setItem(key, JSON.stringify(newData));
  };

  const clearData = () => {
    setData({});
    localStorage.removeItem(key);
  };

  return { data, saveData, clearData, isOnline };
};
