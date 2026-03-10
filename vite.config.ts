import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    server: {
      port: parseInt(env.VITE_PORT) || 3000,
      host: '0.0.0.0',
      strictPort: true
    },
    plugins: [react()],
    define: {
      'process.env.OPENROUTER_API_KEY': JSON.stringify(env.OPENROUTER_API_KEY),
      'import.meta.env.MODE': JSON.stringify(mode)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          features: path.resolve(__dirname, 'features/index.html'),
          pricing: path.resolve(__dirname, 'pricing/index.html'),
          telegramAiBot: path.resolve(__dirname, 'telegram-ai-bot/index.html'),
          telegramCustomerSupportBot: path.resolve(__dirname, 'telegram-customer-support-bot/index.html'),
          telegramLeadGenerationBot: path.resolve(__dirname, 'telegram-lead-generation-bot/index.html'),
          multilingualTelegramBot: path.resolve(__dirname, 'multilingual-telegram-bot/index.html'),
          swiftdeployVsCustomTelegramBotDevelopment: path.resolve(__dirname, 'swiftdeploy-vs-custom-telegram-bot-development/index.html'),
          telegramBotPlatformComparison: path.resolve(__dirname, 'telegram-bot-platform-comparison/index.html'),
          contact: path.resolve(__dirname, 'contact/index.html'),
          privacy: path.resolve(__dirname, 'privacy/index.html'),
          terms: path.resolve(__dirname, 'terms/index.html')
        },
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-components': ['./pages/LandingPage.tsx', './pages/ConnectTelegram.tsx', './pages/ConnectDiscord.tsx']
          }
        }
      },
      chunkSizeWarningLimit: 1000,
      cssCodeSplit: true
    }
  };
});
