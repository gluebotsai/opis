// vite.config.js
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "file:///home/Web_tracking/web_tracking_QA/web/.yarn/__virtual__/vite-virtual-cb2e5de471/5/root/.yarn/berry/cache/vite-npm-5.4.21-12a8265f9b-10c0.zip/node_modules/vite/dist/node/index.js";
import react from "file:///home/Web_tracking/web_tracking_QA/web/.yarn/__virtual__/@vitejs-plugin-react-virtual-91e569251a/5/root/.yarn/berry/cache/@vitejs-plugin-react-npm-4.7.0-650e714693-10c0.zip/node_modules/@vitejs/plugin-react/dist/index.js";
var __vite_injected_original_import_meta_url = "file:///home/Web_tracking/web_tracking_QA/web/vite.config.js";
var repoRoot = path.resolve(path.dirname(fileURLToPath(__vite_injected_original_import_meta_url)), "..");
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const port = parseInt(env.WEB_PORT || "7862", 10);
  const host = env.SERVICE_HOST || "0.0.0.0";
  return {
    envDir: repoRoot,
    plugins: [react()],
    server: {
      host,
      port,
      allowedHosts: ["qatracking.worktual.com", "backend_qatracking", ".worktual.com"],
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/health": { target: apiTarget, changeOrigin: true },
        "/docs": { target: apiTarget, changeOrigin: true }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9XZWJfdHJhY2tpbmcvd2ViX3RyYWNraW5nX1FBL3dlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvV2ViX3RyYWNraW5nL3dlYl90cmFja2luZ19RQS93ZWIvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvV2ViX3RyYWNraW5nL3dlYl90cmFja2luZ19RQS93ZWIvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuXG5jb25zdCByZXBvUm9vdCA9IHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKSwgJy4uJyk7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+IHtcbiAgY29uc3QgZW52ID0gbG9hZEVudihtb2RlLCByZXBvUm9vdCwgJycpO1xuICBjb25zdCBwb3J0ID0gcGFyc2VJbnQoZW52LldFQl9QT1JUIHx8ICc3ODYyJywgMTApO1xuICBjb25zdCBob3N0ID0gZW52LlNFUlZJQ0VfSE9TVCB8fCAnMC4wLjAuMCc7XG5cbiAgcmV0dXJuIHtcbiAgICBlbnZEaXI6IHJlcG9Sb290LFxuICAgIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgICBzZXJ2ZXI6IHtcbiAgICAgIGhvc3QsXG4gICAgICBwb3J0LFxuICAgICAgYWxsb3dlZEhvc3RzOiBbJ3FhdHJhY2tpbmcud29ya3R1YWwuY29tJywgJ2JhY2tlbmRfcWF0cmFja2luZycsICcud29ya3R1YWwuY29tJ10sXG4gICAgICBwcm94eToge1xuICAgICAgICAnL2FwaSc6IHsgdGFyZ2V0OiBhcGlUYXJnZXQsIGNoYW5nZU9yaWdpbjogdHJ1ZSB9LFxuICAgICAgICAnL2hlYWx0aCc6IHsgdGFyZ2V0OiBhcGlUYXJnZXQsIGNoYW5nZU9yaWdpbjogdHJ1ZSB9LFxuICAgICAgICAnL2RvY3MnOiB7IHRhcmdldDogYXBpVGFyZ2V0LCBjaGFuZ2VPcmlnaW46IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFvUyxPQUFPLFVBQVU7QUFDclQsU0FBUyxxQkFBcUI7QUFDOUIsU0FBUyxjQUFjLGVBQWU7QUFDdEMsT0FBTyxXQUFXO0FBSGtLLElBQU0sMkNBQTJDO0FBS3JPLElBQU0sV0FBVyxLQUFLLFFBQVEsS0FBSyxRQUFRLGNBQWMsd0NBQWUsQ0FBQyxHQUFHLElBQUk7QUFFaEYsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxLQUFLLE1BQU07QUFDeEMsUUFBTSxNQUFNLFFBQVEsTUFBTSxVQUFVLEVBQUU7QUFDdEMsUUFBTSxPQUFPLFNBQVMsSUFBSSxZQUFZLFFBQVEsRUFBRTtBQUNoRCxRQUFNLE9BQU8sSUFBSSxnQkFBZ0I7QUFFakMsU0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLElBQ2pCLFFBQVE7QUFBQSxNQUNOO0FBQUEsTUFDQTtBQUFBLE1BQ0EsY0FBYyxDQUFDLDJCQUEyQixzQkFBc0IsZUFBZTtBQUFBLE1BQy9FLE9BQU87QUFBQSxRQUNMLFFBQVEsRUFBRSxRQUFRLFdBQVcsY0FBYyxLQUFLO0FBQUEsUUFDaEQsV0FBVyxFQUFFLFFBQVEsV0FBVyxjQUFjLEtBQUs7QUFBQSxRQUNuRCxTQUFTLEVBQUUsUUFBUSxXQUFXLGNBQWMsS0FBSztBQUFBLE1BQ25EO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
