import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// 프록시 오류를 필터링하는 플러그인
const filterProxyErrorsPlugin = (): Plugin => {
  return {
    name: 'filter-proxy-errors',
    configureServer(server) {
      // Vite의 로거를 가로채서 프록시 오류를 필터링
      const originalLog = server.config.logger.info;
      const originalWarn = server.config.logger.warn;
      const originalError = server.config.logger.error;

      // info 레벨 로그 필터링
      server.config.logger.info = (msg, options) => {
        if (typeof msg === 'string' && (
          msg.includes('ws proxy error') ||
          msg.includes('ws proxy socket error') ||
          (msg.includes('ECONNREFUSED') && msg.includes('proxy')) ||
          msg.includes('write ECONNABORTED') ||
          msg.includes('ECONNABORTED')
        )) {
          return;
        }
        originalLog(msg, options);
      };

      // warn 레벨 로그 필터링
      server.config.logger.warn = (msg, options) => {
        if (typeof msg === 'string' && (
          msg.includes('ws proxy error') ||
          msg.includes('ws proxy socket error') ||
          (msg.includes('ECONNREFUSED') && msg.includes('proxy')) ||
          msg.includes('write ECONNABORTED') ||
          msg.includes('ECONNABORTED')
        )) {
          return;
        }
        originalWarn(msg, options);
      };

      // error 레벨 로그 필터링
      server.config.logger.error = (msg, options) => {
        if (typeof msg === 'string' && (
          msg.includes('ws proxy error') ||
          msg.includes('ws proxy socket error') ||
          (msg.includes('ECONNREFUSED') && msg.includes('proxy')) ||
          msg.includes('write ECONNABORTED') ||
          msg.includes('ECONNABORTED')
        )) {
          return;
        }
        originalError(msg, options);
      };
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    filterProxyErrorsPlugin(),
  ],
  server: {
    host: true, // This ensures Vite listens on all network interfaces
    hmr: {
      // HMR은 자동으로 올바른 주소를 감지하도록 설정
      // host를 명시하지 않으면 브라우저가 접속한 주소를 자동으로 사용
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err: any, _req, _res) => {
            // 서버가 아직 시작되지 않았을 때 발생하는 ECONNREFUSED 에러는 조용히 무시
            if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED') {
              // 개발 환경에서만 조용히 무시
              return;
            }
            // 실제 프록시 오류만 로그 (일반적인 연결 거부는 제외)
            if (!err.message?.includes('ECONNREFUSED')) {
              console.error('[Vite Proxy] API proxy error:', err);
            }
          });
        },
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err: any, _req, _res) => {
            // 서버가 아직 시작되지 않았을 때 발생하는 ECONNREFUSED 에러는 조용히 무시
            if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED') {
              // 개발 환경에서만 조용히 무시
              return;
            }
            // 실제 프록시 오류만 로그 (일반적인 연결 거부는 제외)
            if (!err.message?.includes('ECONNREFUSED')) {
              console.error('[Vite Proxy] WebSocket proxy error:', err);
            }
          });
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            // WebSocket 연결 시도 시 재연결 로직
            socket.on('error', (err: any) => {
              if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED') {
                // 조용히 무시
                return;
              }
            });
          });
        },
      },
    },
    watch: {
      ignored: ['**/vite.config.ts'],
      usePolling: true,
    },
  },
  logLevel: 'warn', // Vite 로그 레벨을 warn으로 설정하여 일반적인 프록시 오류를 줄임
  build: {
    // 코드 스플리팅 최적화
    rollupOptions: {
      output: {
        manualChunks: {
          // React와 React DOM을 별도 청크로 분리
          'react-vendor': ['react', 'react-dom'],
          // 큰 컴포넌트들을 별도 청크로 분리
          'game-components': [
            './Game.tsx',
            './components/GameArena.tsx',
            './components/game/Sidebar.tsx',
          ],
          // 모달들을 별도 청크로 분리
          'modals': [
            './components/InventoryModal.tsx',
            './components/ShopModal.tsx',
            './components/QuestsModal.tsx',
            './components/MailboxModal.tsx',
            './components/BlacksmithModal.tsx',
          ],
        },
      },
    },
    // 청크 크기 경고 임계값 증가 (큰 게임 애플리케이션이므로)
    chunkSizeWarningLimit: 1000,
    // 소스맵은 프로덕션에서 비활성화하여 빌드 속도 향상
    sourcemap: false,
    // Minification 최적화 (esbuild가 기본값이며 더 빠름)
    minify: 'esbuild',
    // terser를 사용하려면 terser 패키지 설치 필요
    // minify: 'terser',
    // terserOptions: {
    //   compress: {
    //     drop_console: true, // console.log 제거 (프로덕션)
    //     drop_debugger: true,
    //   },
    // },
    // CSS 코드 스플리팅
    cssCodeSplit: true,
    // 빌드 시 타입 체크 건너뛰기 (Docker 빌드 환경에서 문제 발생 시)
    // esbuild는 기본적으로 타입 체크를 하지 않지만, 명시적으로 설정
    target: 'esnext',
  },
})