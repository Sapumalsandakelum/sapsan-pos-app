import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 1. base: './' මගින් සියලුම assets පාරවල් relative කරනවා. 
  // මෙය අනිවාර්යයෙන්ම තිබිය යුතුමයි.
  base: './', 
  
  build: {
    // 2. Electron සඳහා build folder එක නිවැරදිව සැකසීම
    outDir: 'dist',
    emptyOutDir: true,
  }
})