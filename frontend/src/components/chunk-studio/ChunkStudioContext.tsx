import { createContext, useContext } from 'react';

export const ChunkStudioContext = createContext<any>(null);

export const useChunkStudio = () => {
  const context = useContext(ChunkStudioContext);
  if (!context) {
    throw new Error('useChunkStudio must be used within ChunkStudioProvider');
  }
  return context;
};

export const ChunkStudioProvider = ChunkStudioContext.Provider;
