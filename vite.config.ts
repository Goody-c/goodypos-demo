import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    esbuild: isProduction
      ? {
          pure: ['console.log', 'console.debug'],
          drop: ['debugger'],
          legalComments: 'none',
        }
      : undefined,
    build: {
      sourcemap: false,
      minify: 'esbuild',
      cssMinify: true,
      reportCompressedSize: false,
      target: 'es2019',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app-[hash].js',
          chunkFileNames: 'assets/chunk-[hash].js',
          assetFileNames: 'assets/asset-[hash][extname]',
          manualChunks(id) {
            if (id.includes('/src/lib/pdf.ts') || id.includes('/src/lib/pdfFontLoader.ts')) {
              return 'pdf-vendor';
            }

            if (id.includes('/src/pages/POS/')) {
              return 'route-pos';
            }

            if (id.includes('/src/pages/SystemAdmin/')) {
              return 'route-system-admin';
            }

            if (id.includes('/src/pages/Audit/')) {
              return 'route-audit';
            }

            if (id.includes('/src/pages/StoreOwner/')) {
              if (/Settings\.tsx$/.test(id)) {
                return 'route-settings';
              }

              if (/(Inventory|ProductOverview|StockAdjustments|Purchases)\.tsx$/.test(id)) {
                return 'route-inventory';
              }

              if (/(Reports|Analytics|FinancialReports|Customers|Expenses)\.tsx$/.test(id)) {
                return 'route-insights';
              }

              if (/(Layaway|Repairs|MarketCollections|TransferVault|Proformas|Returns)\.tsx$/.test(id)) {
                return 'route-operations';
              }

              return 'route-backoffice';
            }

            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('jspdf-autotable') || id.includes('jspdf')) {
              return 'pdf-vendor';
            }

            if (id.includes('react-router-dom')) {
              return 'router-vendor';
            }

            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
              return 'react-vendor';
            }

            if (id.includes('/motion/')) {
              return 'motion-vendor';
            }

            if (id.includes('date-fns')) {
              return 'date-vendor';
            }

            return undefined;
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
